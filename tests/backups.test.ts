import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { actions, commitWorkspace, getGeneration, getScope, getState, initializeFinance, switchWorkspace } from '../src/lib/store'
import { closeDatabase, listBackups, openDatabase, readWorkspace, updateWorkspace } from '../src/lib/repository'
import { createSeed, dataOf, uid } from '../src/lib/model'

beforeEach(async () => {
  await closeDatabase(); vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance()
  await actions.applyDefaultTemplate()
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })
async function makeBackup(amount: number) {
  await commitWorkspace(getScope(), getGeneration(), (workspace, backup) => {
    workspace.state = createSeed()
    workspace.state.accounts[0].initialBalance = amount
    backup('before-change')
    workspace.state.accounts[0].initialBalance = amount + 1
  })
}
async function createConflict() {
  await updateWorkspace(getScope(), (workspace, backup) => {
    backup('sync-conflict-local')
    const remote = createSeed(); remote.accounts[0].initialBalance = 999
    backup('sync-conflict-cloud', remote)
    workspace.conflict = { remote: dataOf(remote), revision: 1, ids: ['accounts/conflict'] }
  })
}
describe('owner-scoped backup retention and deletion', () => {
  it('keeps only the five latest normal backups', async () => {
    for (let i = 1; i <= 8; i++) await makeBackup(i)
    const backups = await listBackups('guest')
    expect(backups).toHaveLength(5)
    expect(backups.map(b => b.state.accounts[0].initialBalance)).toEqual([8, 7, 6, 5, 4])
    expect(backups.every(b => !b.protected)).toBe(true)
  })
  it('reuses identical content and does not back up an unchanged import', async () => {
    await makeBackup(100); const id = (await listBackups('guest'))[0].id
    await makeBackup(100)
    expect(await listBackups('guest')).toHaveLength(1)
    expect((await listBackups('guest'))[0].id).toBe(id)
    const before = await readWorkspace('guest'); const backups = await listBackups('guest')
    await actions.importJSON(actions.exportJSON())
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toEqual(backups)
  })
  it('deletes one or all backups without changing finance, sync metadata, or another owner', async () => {
    await makeBackup(10); await makeBackup(20)
    const guestBackups = await listBackups('guest'); const guestState = structuredClone(getState())
    const userId = uid(); await switchWorkspace(userId); await makeBackup(30)
    const before = await readWorkspace(getScope())
    expect(await actions.deleteBackup(guestBackups[0].id)).toBe(false)
    await expect(actions.deleteBackups('guest')).rejects.toThrow('Sesi berubah')
    expect(await actions.deleteBackups()).toBe(1)
    const after = await readWorkspace(getScope())
    expect(after.state).toEqual(before.state)
    expect(after.base).toEqual(before.base)
    expect(after.pending).toEqual(before.pending)
    expect(after.revision).toBe(before.revision)
    expect(await listBackups('guest')).toHaveLength(2)
    await switchWorkspace(null)
    expect(await actions.deleteBackup(guestBackups[0].id)).toBe(true)
    expect(await listBackups('guest')).toHaveLength(1)
    expect(await actions.deleteBackups()).toBe(1)
    expect(await listBackups('guest')).toHaveLength(0)
    expect(getState()).toEqual(guestState)
  })
  it('rejects deletion from a previous login generation', async () => {
    await makeBackup(10); const scope = getScope(); const token = getGeneration()
    await switchWorkspace(uid()); await switchWorkspace(null)
    await expect(actions.deleteBackups(scope, token)).rejects.toThrow('Sesi berubah')
    expect(await listBackups('guest')).toHaveLength(1)
  })
  it('protects unresolved conflict snapshots while limiting and clearing only normal copies', async () => {
    await createConflict()
    const protectedIds = (await listBackups('guest')).map(b => b.id)
    expect(protectedIds).toHaveLength(2)
    for (let i = 1; i <= 8; i++) await makeBackup(i)
    const backups = await listBackups('guest')
    expect(backups.filter(b => b.protected).map(b => b.id).sort()).toEqual(protectedIds.sort())
    expect(backups.filter(b => !b.protected)).toHaveLength(5)
    await expect(actions.deleteBackup(protectedIds[0])).rejects.toThrow('dilindungi')
    expect(await actions.deleteBackups()).toBe(5)
    expect((await listBackups('guest')).every(b => b.protected)).toBe(true)
    await updateWorkspace('guest', workspace => { workspace.conflict = null })
    expect((await listBackups('guest')).every(b => !b.protected)).toBe(true)
    expect(await actions.deleteBackups()).toBe(2)
  })
  it('does not reprotect copies from an already resolved conflict', async () => {
    await createConflict(); const oldIds = (await listBackups('guest')).map(b => b.id)
    await updateWorkspace('guest', workspace => { workspace.conflict = null })
    await createConflict()
    const backups = await listBackups('guest')
    expect(backups.filter(b => b.protected)).toHaveLength(2)
    expect(backups.filter(b => b.protected).every(b => !oldIds.includes(b.id))).toBe(true)
  })
  it('protects existing unresolved conflict copies when loading pre-policy data', async () => {
    const db = await openDatabase()
    const workspace = await readWorkspace('guest')
    workspace.conflict = { remote: dataOf(createSeed()), revision: 1, ids: ['legacy'] }
    const id = uid()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['workspaces', 'backups'], 'readwrite')
      tx.objectStore('workspaces').put(workspace)
      tx.objectStore('backups').put({ id, scope: 'guest', at: '2026-01-01T00:00:00.000Z', reason: 'sync-conflict-local', state: createSeed() })
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    })
    await switchWorkspace(null)
    expect((await listBackups('guest'))[0]).toMatchObject({ id, protected: true })
    await expect(actions.deleteBackup(id)).rejects.toThrow('dilindungi')
  })
  it('applies retention to old accumulated backups on load without altering financial data', async () => {
    const db = await openDatabase(); const before = structuredClone(getState())
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite')
      for (let i = 1; i <= 9; i++) {
        const state = createSeed(); state.accounts[0].initialBalance = i
        tx.objectStore('backups').put({ id: uid(), scope: 'guest', at: `2026-01-0${i}T00:00:00.000Z`, reason: 'before-reset', state })
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    })
    await switchWorkspace(null)
    expect((await listBackups('guest')).map(b => b.state.accounts[0].initialBalance)).toEqual([9, 8, 7, 6, 5])
    expect(getState()).toEqual(before)
  })
  it('rolls back failed deletion and preserves all prior copies', async () => {
    await makeBackup(10); await makeBackup(20)
    const before = await readWorkspace('guest'); const backups = await listBackups('guest')
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(() => { throw new Error('Delete failed') })
    await expect(actions.deleteBackup(backups[0].id)).rejects.toThrow('Delete failed')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toEqual(backups)
  })
})
