import { describe, expect, it } from 'vitest'
import { createSeed, dataOf, emptyData, uid, type Data } from '../src/lib/model'
import { newWorkspace, type Workspace } from '../src/lib/repository'
import { DataConflict, reconcile } from '../src/lib/reconcile'
import { synchronize, type LocalSync, type Transport } from '../src/lib/syncEngine'
import { resetToEmpty } from '../src/lib/reset'

function client(base: Data = dataOf(createSeed())) {
  let workspace: Workspace = newWorkspace(`user:${uid()}`, createSeed())
  workspace.base = structuredClone(base); workspace.state = { ...structuredClone(base), settings: workspace.state.settings }; workspace.revision = 1
  let active = true
  const backups: unknown[] = []
  const local: LocalSync = {
    active: () => active,
    read: async () => structuredClone(workspace),
    update: async apply => {
      const next = structuredClone(workspace)
      const result = apply(next, (reason, state = next.state) => backups.push({ reason, state: structuredClone(state) }))
      workspace = next
      return result
    },
  }
  return { local, get: () => workspace, edit: (apply: (state: Workspace['state']) => void) => apply(workspace.state), deactivate: () => { active = false }, backups }
}
function cloud(initial: Data = dataOf(createSeed()), conflictCode = 'PT409') {
  let data = structuredClone(initial); let revision = 1; let writes = 0
  const operations = new Map<string, number>()
  const transport: Transport = {
    read: async () => ({ revision, state: structuredClone(data) }),
    push: async (expected, id, next) => {
      if (operations.has(id)) return { revision: operations.get(id)! }
      if (expected !== revision) throw Object.assign(new Error('stale'), { code: conflictCode })
      data = structuredClone(next); writes++; revision++; operations.set(id, revision)
      return { revision }
    },
  }
  return { transport, get: () => data, writes: () => writes, edit: (apply: (data: Data) => void) => { apply(data); revision++ } }
}
describe('versioned synchronization', () => {
  it('syncs one reset to an empty active dataset and does not push repeated resets', async () => {
    const initial = createSeed()
    initial.accounts[0].initialBalance = 700
    initial.transactions.push({ id: uid(), accountId: initial.accounts[0].id, categoryId: initial.categories.find(c => c.type === 'income')!.id, type: 'income', amount: 100, date: '2026-11-16', updatedAt: new Date().toISOString(), deletedAt: null })
    const local = client(dataOf(initial)); const remote = cloud(dataOf(initial))
    local.edit(state => Object.assign(state, resetToEmpty(state).state))
    await synchronize(local.local, remote.transport)
    expect(remote.get().accounts.map(row => row.id)).toEqual(initial.accounts.map(row => row.id))
    expect(remote.get().accounts.filter(row => !row.deletedAt)).toHaveLength(0)
    expect(remote.get().categories.filter(row => !row.deletedAt)).toHaveLength(0)
    expect(remote.get().transactions[0].deletedAt).toBeTruthy()
    for (let i = 0; i < 10; i++) {
      expect(resetToEmpty(local.get().state).changed).toBe(false)
      await synchronize(local.local, remote.transport)
    }
    expect(remote.writes()).toBe(1)
    expect(remote.get().accounts).toHaveLength(3)
    expect(remote.get().categories).toHaveLength(7)
  })
  it('keeps a reset made while the previous snapshot is being acknowledged', async () => {
    const local = client(); const remote = cloud()
    local.edit(state => { state.accounts[0].initialBalance = 500 })
    const push = remote.transport.push; let resetOnce = true
    remote.transport.push = async (...args) => {
      const result = await push(...args)
      if (resetOnce) { resetOnce = false; local.edit(state => Object.assign(state, resetToEmpty(state).state)) }
      return result
    }
    await synchronize(local.local, remote.transport)
    expect(remote.get().accounts[0].deletedAt).toBeTruthy()
    expect(remote.get().accounts.filter(row => !row.deletedAt)).toHaveLength(0)
    expect(remote.get().accounts).toHaveLength(3)
    expect(local.get().pending).toBeNull()
    expect(remote.writes()).toBe(2)
  })
  it('pulls a newer cloud edit without overwriting it with a stale local row', async () => {
    const local = client(); const remote = cloud()
    remote.edit(data => { data.accounts[0].name = 'New cloud name' })
    await synchronize(local.local, remote.transport)
    expect(remote.get().accounts[0].name).toBe('New cloud name')
    expect(local.get().state.accounts.find(a => a.id === createSeed().accounts[0].id)?.name).toBe('New cloud name')
    expect(remote.writes()).toBe(0)
  })
  it('merges independent edits even when device timestamps are wrong', async () => {
    const local = client(); const remote = cloud()
    local.edit(state => { state.accounts[0].name = 'Local'; state.accounts[0].updatedAt = '1990-01-01T00:00:00.000Z' })
    remote.edit(state => { state.accounts[1].name = 'Cloud'; state.accounts[1].updatedAt = '2099-01-01T00:00:00.000Z' })
    await synchronize(local.local, remote.transport)
    expect(remote.get().accounts.some(a => a.name === 'Local')).toBe(true)
    expect(remote.get().accounts.some(a => a.name === 'Cloud')).toBe(true)
    expect(local.get().pending).toBeNull()
  })
  it('preserves both sides of an edit conflict and never pushes it blindly', async () => {
    const local = client(); const remote = cloud()
    local.edit(state => { state.accounts[0].initialBalance = 100 })
    remote.edit(state => { state.accounts[0].initialBalance = 200 })
    await expect(synchronize(local.local, remote.transport)).rejects.toBeInstanceOf(DataConflict)
    expect(local.get().state.accounts[0].initialBalance).toBe(100)
    expect(local.get().conflict?.remote.accounts[0].initialBalance).toBe(200)
    expect(local.backups).toHaveLength(2)
    expect(remote.writes()).toBe(0)
  })
  it('retries a response lost after server commit with the same durable operation ID', async () => {
    const local = client(); const remote = cloud(); let dropResponse = true
    local.edit(state => { state.accounts[0].initialBalance = 100 })
    const originalPush = remote.transport.push
    remote.transport.push = async (...args) => {
      const response = await originalPush(...args)
      if (dropResponse) { dropResponse = false; throw new Error('network timeout') }
      return response
    }
    await expect(synchronize(local.local, remote.transport)).rejects.toThrow('timeout')
    const id = local.get().pending?.id
    expect(id).toBeTruthy()
    await synchronize(local.local, remote.transport)
    expect(remote.writes()).toBe(1)
    expect(local.get().pending).toBeNull()
  })
  it('keeps a new local edit made while an older snapshot is being acknowledged', async () => {
    const local = client(); const remote = cloud()
    local.edit(state => { state.accounts[0].initialBalance = 100 })
    const push = remote.transport.push; let editOnce = true
    remote.transport.push = async (...args) => {
      const result = await push(...args)
      if (editOnce) { editOnce = false; local.edit(state => { state.accounts[0].initialBalance = 250 }) }
      return result
    }
    await synchronize(local.local, remote.transport)
    expect(remote.get().accounts[0].initialBalance).toBe(250)
    expect(local.get().pending).toBeNull()
  })
  it.each(['PT409', '40001'])('reconciles a version conflict after pull and before push (%s)', async code => {
    const local = client(); const remote = cloud(dataOf(createSeed()), code)
    local.edit(state => { state.accounts[0].name = 'Local rename' })
    const push = remote.transport.push; let raceOnce = true
    remote.transport.push = async (...args) => {
      if (raceOnce) { raceOnce = false; remote.edit(state => { state.accounts[1].name = 'Other device' }) }
      return push(...args)
    }
    await synchronize(local.local, remote.transport)
    expect(remote.get().accounts.some(a => a.name === 'Other device')).toBe(true)
    expect(remote.get().accounts.some(a => a.name === 'Local rename')).toBe(true)
    expect(remote.writes()).toBe(1)
    expect(local.get().pending).toBeNull()
  })
  it('pulls after a rejected durable pending request before preparing a new operation', async () => {
    const local = client(); const remote = cloud()
    local.edit(state => { state.accounts[0].initialBalance = 100 })
    const originalId = uid()
    local.get().pending = { id: originalId, revision: 1, data: dataOf(structuredClone(local.get().state)) }
    remote.edit(state => { state.accounts[1].initialBalance = 200 })
    const events: string[] = []; const read = remote.transport.read; const push = remote.transport.push
    remote.transport.read = async () => { events.push('read'); return read() }
    remote.transport.push = async (revision, id, state) => { events.push(`push:${revision}:${id === originalId ? 'old' : 'new'}`); return push(revision, id, state) }
    await synchronize(local.local, remote.transport)
    expect(events).toEqual(['push:1:old', 'read', 'push:2:new', 'read'])
    expect(remote.get().accounts[0].initialBalance).toBe(100)
    expect(remote.get().accounts[1].initialBalance).toBe(200)
    expect(remote.writes()).toBe(1)
    expect(local.get().pending).toBeNull()
  })
  it('preserves both versions if the reread after PT409 discovers a same-row conflict', async () => {
    const local = client(); const remote = cloud()
    local.edit(state => { state.accounts[0].initialBalance = 100 })
    local.get().pending = { id: uid(), revision: 1, data: dataOf(structuredClone(local.get().state)) }
    remote.edit(state => { state.accounts[0].initialBalance = 200 })
    await expect(synchronize(local.local, remote.transport)).rejects.toBeInstanceOf(DataConflict)
    expect(local.get().state.accounts[0].initialBalance).toBe(100)
    expect(local.get().conflict?.remote.accounts[0].initialBalance).toBe(200)
    expect(local.get().pending).toBeNull()
    expect(local.backups).toHaveLength(2)
    expect(remote.writes()).toBe(0)
  })
  it('bounds repeated PT409 rejections without losing local edits or replaying one stale operation', async () => {
    const local = client(); const remote = cloud(); const operations: string[] = []
    local.edit(state => { state.accounts[0].initialBalance = 100 })
    remote.transport.push = async (_revision, id) => {
      operations.push(id)
      throw Object.assign(new Error('Cloud changed; reconcile first'), { code: 'PT409' })
    }
    await expect(synchronize(local.local, remote.transport)).rejects.toThrow('Data masih berubah')
    expect(operations).toHaveLength(4)
    expect(new Set(operations).size).toBe(4)
    expect(local.get().state.accounts[0].initialBalance).toBe(100)
    expect(local.get().pending).toBeNull()
    expect(remote.writes()).toBe(0)
  })
  it('does not advance a local checkpoint if the local transaction fails', async () => {
    const local = client(); const remote = cloud()
    remote.edit(data => { data.accounts[0].name = 'Remote' })
    const saved = local.get()
    const broken = { ...local.local, update: async () => { throw new Error('disk full') } }
    await expect(synchronize(broken, remote.transport)).rejects.toThrow('disk full')
    expect(local.get()).toEqual(saved)
  })
  it('does not apply a previous owner response after logout', async () => {
    const local = client(); const remote = cloud(); const before = structuredClone(local.get())
    const read = remote.transport.read
    remote.transport.read = async () => { const result = await read(); local.deactivate(); return result }
    await expect(synchronize(local.local, remote.transport)).rejects.toThrow('Sesi berubah')
    expect(local.get()).toEqual(before)
  })
  it('never resurrects an unchanged offline row after permanent deletion', () => {
    const base = dataOf(createSeed()); const remote = structuredClone(base); const id = remote.accounts[0].id
    remote.accounts = remote.accounts.filter(a => a.id !== id); remote.purged.accounts.push(id)
    expect(reconcile(base, base, remote).accounts.some(a => a.id === id)).toBe(false)
  })
  it('preserves a local edit as a conflict when the cloud permanently removes that row', () => {
    const base = dataOf(createSeed()); const local = structuredClone(base); const remote = structuredClone(base); const id = remote.accounts[0].id
    local.accounts[0].initialBalance = 500
    remote.accounts = remote.accounts.filter(a => a.id !== id); remote.purged.accounts.push(id)
    expect(() => reconcile(base, local, remote)).toThrow(DataConflict)
    expect(() => reconcile(base, local, remote, 'local')).toThrow('dimusnahkan')
    expect(reconcile(base, local, remote, 'remote').accounts.some(a => a.id === id)).toBe(false)
  })
  it('allows an explicit choice when an unacknowledged local purge conflicts with a cloud edit', () => {
    const base = dataOf(createSeed()); const local = structuredClone(base); const remote = structuredClone(base); const id = local.accounts[0].id
    local.accounts = local.accounts.filter(a => a.id !== id); local.purged.accounts.push(id)
    remote.accounts[0].initialBalance = 400
    expect(() => reconcile(base, local, remote)).toThrow(DataConflict)
    expect(reconcile(base, local, remote, 'remote').purged.accounts).not.toContain(id)
    expect(reconcile(base, local, remote, 'local').purged.accounts).toContain(id)
  })
  it('bootstraps a brand-new cloud without duplicate seed identities', async () => {
    const local = client(emptyData()); local.edit(state => Object.assign(state, createSeed()))
    const remote = cloud(emptyData())
    await synchronize(local.local, remote.transport)
    expect(remote.get().accounts).toHaveLength(3)
    expect(remote.get().categories).toHaveLength(7)
  })
})
