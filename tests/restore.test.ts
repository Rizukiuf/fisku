import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { actions, getGeneration, getScope, getState, initializeFinance, subscribeStore, switchWorkspace } from '../src/lib/financeStore'
import { closeDatabase, listBackups, readWorkspace, updateWorkspace } from '../src/lib/repository'
import { createSeed, dataOf, decodeState, entityKeys, uid, type State } from '../src/lib/model'

const at = '2026-11-16T12:00:00.000Z'
function trashGraph(): State {
  const state = createSeed()
  state.accounts[0].initialBalance = -100
  state.accounts[0].deletedAt = at
  state.accounts[1].deletedAt = at
  state.categories[0].deletedAt = at
  state.categories[2].deletedAt = at
  state.transactions = [
    { id: uid(), accountId: state.accounts[0].id, categoryId: state.categories[0].id, type: 'income', amount: 100, date: '2026-11-16', note: 'Salary', updatedAt: at, deletedAt: at },
    { id: uid(), accountId: state.accounts[0].id, targetAccountId: state.accounts[1].id, type: 'transfer', amount: 20, date: '2026-11-16', updatedAt: at, deletedAt: at },
    { id: uid(), accountId: state.accounts[2].id, categoryId: state.categories[2].id, type: 'expense', amount: 30, date: '2026-11-16', updatedAt: at, deletedAt: at },
  ]
  state.budgets = [{ id: uid(), categoryId: state.categories[2].id, limit: 500, updatedAt: at, deletedAt: at }]
  state.settings = { theme: 'dark', lang: 'en' }
  state.purged.accounts = [uid()]
  return decodeState(state)
}
async function load(state: State) {
  await updateWorkspace('guest', workspace => { workspace.state = state })
  await switchWorkspace(null)
}
beforeEach(async () => {
  await closeDatabase()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance()
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })

describe('restore all trash atomically', () => {
  it('restores parents before their transactions, transfer, and budget without changing identities or active rows', async () => {
    const before = trashGraph(); await load(before)
    const result = await actions.restoreAll()
    expect(result).toEqual({ changed: true, restored: { accounts: 2, categories: 2, transactions: 3, budgets: 1 }, skipped: { account_missing: 0, category_missing: 0, target_account_missing: 0, invalid_limit: 0, name_conflict: 0 } })
    const restored = getState()
    for (const key of entityKeys) {
      expect(restored[key].map(row => row.id)).toEqual(before[key].map(row => row.id))
      for (const row of before[key]) {
        const next = restored[key].find(item => item.id === row.id)!
        expect(next).toEqual(row.deletedAt ? { ...row, deletedAt: null, updatedAt: next.updatedAt } : row)
      }
    }
    expect(restored.settings).toEqual(before.settings)
    expect(restored.purged).toEqual(before.purged)
    const backups = await listBackups('guest')
    expect(backups).toHaveLength(1)
    expect(backups[0].reason).toBe('before-restore-all')
    expect(backups[0].state).toEqual(before)
    await switchWorkspace(null)
    expect(getState()).toEqual(restored)
  })

  it('leaves zero-limit budgets in trash, reports the reason, and becomes a no-op', async () => {
    const state = trashGraph(); state.budgets[0].limit = 0; await load(state)
    const result = await actions.restoreAll()
    expect(result.restored).toEqual({ accounts: 2, categories: 2, transactions: 3, budgets: 0 })
    expect(result.skipped).toEqual({ account_missing: 0, category_missing: 0, target_account_missing: 0, invalid_limit: 1, name_conflict: 0 })
    expect(getState().budgets).toEqual(state.budgets)
    const before = await readWorkspace('guest'); const backups = await listBackups('guest')
    expect((await actions.restoreAll()).changed).toBe(false)
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toEqual(backups)
  })

  it('does not write metadata or backups for empty trash and never revives purged IDs', async () => {
    const state = createSeed(); state.purged.transactions = [uid()]; await load(state)
    const before = await readWorkspace('guest')
    expect(await actions.restoreAll()).toEqual({ changed: false, restored: { accounts: 0, categories: 0, transactions: 0, budgets: 0 }, skipped: { account_missing: 0, category_missing: 0, target_account_missing: 0, invalid_limit: 0, name_conflict: 0 } })
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toHaveLength(0)
  })

  it.each(['backups', 'workspaces'])('rolls back state and backup and publishes nothing if the %s write runs out of quota', async storeName => {
    await load(trashGraph()); const before = await readWorkspace('guest')
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === storeName) throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    const published = vi.fn(); const unsubscribe = subscribeStore(published)
    try {
      await expect(actions.restoreAll()).rejects.toThrow('Full')
      expect(getState()).toEqual(before.state)
      expect(published).not.toHaveBeenCalled()
      expect(await readWorkspace('guest')).toEqual(before)
      expect(await listBackups('guest')).toHaveLength(0)
    } finally { unsubscribe() }
  })

  it('rejects an old confirmation after owner or generation changes', async () => {
    await load(trashGraph())
    const options = { expectedScope: getScope(), expectedGeneration: getGeneration(), expectedState: getState() }
    const guest = await readWorkspace('guest')
    await switchWorkspace(uid())
    await expect(actions.restoreAll(options)).rejects.toThrow('Sesi berubah')
    await switchWorkspace(null)
    await expect(actions.restoreAll(options)).rejects.toThrow('Sesi berubah')
    expect(await readWorkspace('guest')).toEqual(guest)
    expect(await listBackups('guest')).toHaveLength(0)
  })

  it('rejects a stale confirmation against the durable data even before the visible store refreshes', async () => {
    await load(trashGraph()); const expectedState = getState()
    await updateWorkspace('guest', current => { current.state.accounts[2].initialBalance = 1 })
    const before = await readWorkspace('guest')
    await expect(actions.restoreAll({ expectedState })).rejects.toThrow('Data berubah')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toHaveLength(0)
    await expect(actions.restoreAll()).rejects.toThrow('Data berubah')
  })

  it('allows heartbeat and preference changes while preserving pending, base, receipts and local ID caches', async () => {
    await load(trashGraph()); const expectedState = getState()
    await updateWorkspace('guest', current => {
      current.state.accounts[2].updatedAt = at
      current.state.settings = { theme: 'light', lang: 'id' }
      current.base = dataOf(createSeed()); current.revision = 3
      current.pending = { id: uid(), revision: 3, data: dataOf(current.state) }
      current.lastSync = at; current.guestImport = 'a'.repeat(64)
      current.importIds = { accounts: { [uid()]: current.state.accounts[0].id }, categories: {}, transactions: {}, budgets: {} }
      current.mergeIds = { accounts: {}, categories: { [uid()]: current.state.categories[0].id }, transactions: {}, budgets: {} }
    })
    const before = await readWorkspace('guest')
    await actions.restoreAll({ expectedState })
    const after = await readWorkspace('guest')
    for (const key of ['base', 'revision', 'pending', 'lastSync', 'guestImport', 'importIds', 'mergeIds', 'onboarding'] as const) expect(after[key]).toEqual(before[key])
    expect(after.state.settings).toEqual({ theme: 'light', lang: 'id' })
  })

  it('keeps an account with a reused name and its children in trash while restoring unrelated rows', async () => {
    const state = trashGraph(); state.accounts[0].name = ` ${state.accounts[2].name.toUpperCase()} `; await load(state)
    const before = getState()
    const result = await actions.restoreAll()
    expect(result.restored).toEqual({ accounts: 1, categories: 2, transactions: 1, budgets: 1 })
    expect(result.skipped).toEqual({ account_missing: 2, category_missing: 0, target_account_missing: 0, invalid_limit: 0, name_conflict: 1 })
    expect(getState().accounts[0]).toEqual(before.accounts[0])
    expect(getState().transactions.slice(0, 2)).toEqual(before.transactions.slice(0, 2))
    expect(getState().accounts[2]).toEqual(before.accounts[2])
    expect((await listBackups('guest'))[0].state).toEqual(before)
  })

  it('keeps a transfer in trash if its target account name conflicts', async () => {
    const state = trashGraph(); state.accounts[1].name = state.accounts[2].name; await load(state)
    const before = getState()
    const result = await actions.restoreAll()
    expect(result.restored).toEqual({ accounts: 1, categories: 2, transactions: 2, budgets: 1 })
    expect(result.skipped).toEqual({ account_missing: 0, category_missing: 0, target_account_missing: 1, invalid_limit: 0, name_conflict: 1 })
    expect(getState().accounts[1]).toEqual(before.accounts[1])
    expect(getState().transactions[1]).toEqual(before.transactions[1])
  })

  it('keeps conflicting categories, their transactions and budgets in trash', async () => {
    const state = trashGraph()
    state.categories[0].name = state.categories[1].name.toLowerCase()
    state.categories[2].name = ` ${state.categories[3].name.toUpperCase()} `
    await load(state); const before = getState()
    const result = await actions.restoreAll()
    expect(result.restored).toEqual({ accounts: 2, categories: 0, transactions: 1, budgets: 0 })
    expect(result.skipped).toEqual({ account_missing: 0, category_missing: 3, target_account_missing: 0, invalid_limit: 0, name_conflict: 2 })
    expect(getState().categories).toEqual(before.categories)
    expect(getState().budgets).toEqual(before.budgets)
    expect(getState().transactions[0]).toEqual(before.transactions[0])
    expect(getState().transactions[2]).toEqual(before.transactions[2])
  })

  it('skips every ambiguous tombstone name without choosing by order and treats category types separately', async () => {
    const state = trashGraph()
    state.accounts[0].name = ' Duplicated '; state.accounts[1].name = 'DUPLICATED'
    state.categories[0].name = 'Shared'; state.categories[1].name = ' SHARED '; state.categories[1].deletedAt = at
    state.categories[2].name = 'shared'
    await load(state); const before = getState()
    const result = await actions.restoreAll()
    expect(result.restored).toEqual({ accounts: 0, categories: 1, transactions: 1, budgets: 1 })
    expect(result.skipped).toEqual({ account_missing: 2, category_missing: 0, target_account_missing: 0, invalid_limit: 0, name_conflict: 4 })
    expect(getState().accounts).toEqual(before.accounts)
    expect(getState().categories.slice(0, 2)).toEqual(before.categories.slice(0, 2))
    expect(getState().categories[2].deletedAt).toBeNull()
  })

  it('does not write a backup or metadata if every tombstone has a name conflict', async () => {
    const state = createSeed()
    state.accounts[0].deletedAt = at; state.accounts[0].name = state.accounts[1].name
    await load(state); const before = await readWorkspace('guest')
    const result = await actions.restoreAll()
    expect(result.changed).toBe(false)
    expect(result.skipped.name_conflict).toBe(1)
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toHaveLength(0)
  })

  it('rejects aggregate overflow without restoring any parents, children, or backup', async () => {
    const state = trashGraph(); state.accounts[0].initialBalance = Number.MAX_SAFE_INTEGER; await load(state)
    const before = await readWorkspace('guest')
    await expect(actions.restoreAll()).rejects.toThrow('batas aman')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(getState()).toEqual(before.state)
    expect(await listBackups('guest')).toHaveLength(0)
  })
})
