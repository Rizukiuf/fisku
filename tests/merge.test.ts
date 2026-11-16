import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { actions, getState, initializeFinance, totalBalance } from '../src/lib/store'
import { closeDatabase, listBackups, readWorkspace } from '../src/lib/repository'
import { emptyState, now, uid } from '../src/lib/model'

beforeEach(async () => {
  await closeDatabase(); vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance(); await actions.chooseStart('empty')
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })
const stamp = () => ({ id: uid(), updatedAt: now(), deletedAt: null })
async function setup() {
  const account = await actions.addAccount({ name: 'Bank', type: 'bank', initialBalance: 0 })
  const category = await actions.addCategory({ name: 'Food', type: 'expense' })
  return { account, category }
}
function source(amount?: number) {
  const state = emptyState()
  state.accounts.push({ ...stamp(), name: 'Bank', type: 'bank', initialBalance: 0 })
  state.categories.push({ ...stamp(), name: 'Food', type: 'expense' })
  if (amount !== undefined) state.transactions.push({ ...stamp(), type: 'expense', amount, date: '2026-11-16', accountId: state.accounts[0].id, categoryId: state.categories[0].id })
  return state
}

describe('reviewed import merge', () => {
  it('maps case-insensitive account/category names, retains unrelated local data, and links the new transaction', async () => {
    const bank = await actions.addAccount({ name: 'Bank', type: 'bank', initialBalance: 0 })
    const savings = await actions.addAccount({ name: 'Savings', type: 'cash', initialBalance: 100 })
    const food = await actions.addCategory({ name: 'Food', type: 'expense' })
    const incoming = emptyState(); incoming.settings.lang = 'en'
    incoming.accounts.push({ ...stamp(), name: ' bank ', type: 'bank', initialBalance: 0 })
    incoming.categories.push({ ...stamp(), name: 'FOOD', type: 'expense' })
    incoming.transactions.push({ ...stamp(), type: 'expense', accountId: incoming.accounts[0].id, categoryId: incoming.categories[0].id, amount: 50, date: '2026-11-16' })
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })
    expect(getState().accounts.filter(row => !row.deletedAt).map(row => row.id)).toEqual([bank.id, savings.id])
    expect(getState().categories.filter(row => !row.deletedAt).map(row => row.id)).toEqual([food.id])
    expect(getState().transactions[0]).toMatchObject({ accountId: bank.id, categoryId: food.id, amount: 50 })
    expect(totalBalance(getState().accounts, getState().transactions)).toBe(50)
    expect(getState().settings.lang).toBe('id')
  })
  it('does not sum conflicting opening balances and requires a value choice', async () => {
    const { account } = await setup(); await actions.updateAccount(account.id, { initialBalance: 100 })
    const incoming = source(5); incoming.accounts[0].initialBalance = 200
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { values: { [`balance:${account.id}`]: 'local' } } })
    expect(getState().accounts.find(row => row.id === account.id)?.initialBalance).toBe(100)
    expect(totalBalance(getState().accounts, getState().transactions)).toBe(95)
  })
  it('chooses an imported budget limit without summing or creating a second budget for the mapped category', async () => {
    const { category } = await setup(); await actions.setBudget(category.id, 100)
    const localId = getState().budgets[0].id
    const incoming = source(); incoming.budgets.push({ ...stamp(), categoryId: incoming.categories[0].id, limit: 200 })
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { values: { [`budget:${category.id}`]: `source:${incoming.budgets[0].id}` } } })
    expect(getState().budgets).toHaveLength(1)
    expect(getState().budgets[0]).toMatchObject({ id: localId, categoryId: category.id, limit: 200 })
  })
  it('keeps the local and imported transactions when different IDs look identical and the user chooses add', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const incoming = source(25)
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { transactions: { [incoming.transactions[0].id]: 'add' } } })
    expect(getState().transactions.filter(row => !row.deletedAt)).toHaveLength(2)
    expect(totalBalance(getState().accounts, getState().transactions)).toBe(-50)
  })
  it('retains two new same-day purchases with identical fields and different source IDs', async () => {
    await setup(); const incoming = source(25)
    incoming.transactions.push({ ...incoming.transactions[0], id: uid() })
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })
    expect(getState().transactions.filter(row => !row.deletedAt)).toHaveLength(2)
    expect(totalBalance(getState().accounts, getState().transactions)).toBe(-50)
  })
  it('can explicitly match a possible duplicate and remembers its identity across repeated merges', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const localId = getState().transactions[0].id; const incoming = source(25)
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { transactions: { [incoming.transactions[0].id]: `match:${localId}` } } })
    expect(getState().transactions).toHaveLength(1)
    expect(getState().transactions[0].id).toBe(localId)
    const merged = await readWorkspace('guest'); const backups = await listBackups('guest')
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })
    expect(await readWorkspace('guest')).toEqual(merged)
    expect(await listBackups('guest')).toEqual(backups)
  })
  it('requires a choice for an edited transaction with the same ID', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const incoming = structuredClone(getState()); incoming.transactions[0].amount = 40
    const id = incoming.transactions[0].id
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { transactions: { [id]: 'incoming' } } })
    expect(getState().transactions).toHaveLength(1)
    expect(getState().transactions[0]).toMatchObject({ id, amount: 40 })
  })
  it('does not delete active local transactions or apply foreign purge markers from the source', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const extra = await actions.addAccount({ name: 'Local only', type: 'cash', initialBalance: 50 })
    const incoming = structuredClone(getState())
    incoming.accounts = incoming.accounts.filter(row => row.id !== extra.id)
    incoming.purged.accounts.push(extra.id)
    incoming.transactions[0].deletedAt = now()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })
    expect(getState().accounts.find(row => row.id === extra.id)?.deletedAt).toBeNull()
    expect(getState().transactions[0].deletedAt).toBeNull()
    expect(getState().purged.accounts).not.toContain(extra.id)
    expect(totalBalance(getState().accounts, getState().transactions)).toBe(25)
  })
  it('does not trust a canonical account ID when its source name differs and supports an explicit new copy', async () => {
    const { account } = await setup(); const incoming = structuredClone(getState())
    incoming.accounts[0].name = 'Other bank'
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { entities: { [`accounts:${account.id}`]: 'new' } } })
    expect(getState().accounts.filter(row => !row.deletedAt)).toHaveLength(2)
    expect(getState().accounts.find(row => row.id === account.id)?.name).toBe('Bank')
    expect(getState().accounts.find(row => row.name === 'Other bank')?.id).not.toBe(account.id)
  })
  it('requires mapping for category type differences instead of changing the local category type', async () => {
    const { category } = await setup(); const incoming = structuredClone(getState())
    incoming.categories[0].type = 'income'
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { entities: { [`categories:${category.id}`]: 'new' } } })
    expect(getState().categories).toHaveLength(2)
    expect(getState().categories.find(row => row.id === category.id)?.type).toBe('expense')
  })
  it('restores purged source rows only with an explicit recovery choice and never reuses their old IDs', async () => {
    await setup(); const incoming = structuredClone(getState())
    await actions.reset(); await actions.purgeDeleted()
    const purged = structuredClone(getState().purged)
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { recoverDeleted: true } })
    expect(getState().purged).toEqual(purged)
    expect(getState().accounts[0].id).not.toBe(incoming.accounts[0].id)
    expect(getState().categories[0].id).not.toBe(incoming.categories[0].id)
    const merged = await readWorkspace('guest')
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })
    expect(await readWorkspace('guest')).toEqual(merged)
  })
  it('does not silently turn a transfer into a self-transfer when both source accounts map to one target', async () => {
    const { account } = await setup(); const incoming = source()
    incoming.accounts.push({ ...stamp(), name: 'Second bank', type: 'bank', initialBalance: 0 })
    incoming.transactions.push({ ...stamp(), type: 'transfer', amount: 5, date: '2026-11-16', accountId: incoming.accounts[0].id, targetAccountId: incoming.accounts[1].id })
    const entities = { [`accounts:${incoming.accounts[1].id}`]: account.id }
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { entities } })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { entities, transactions: { [incoming.transactions[0].id]: 'skip' } } })
    expect(getState().transactions).toHaveLength(0)
    expect(getState().accounts).toHaveLength(1)
  })
  it('explicitly restores an existing soft-deleted budget without violating one-budget-per-category', async () => {
    const { category } = await setup(); await actions.setBudget(category.id, 100)
    const incoming = structuredClone(getState()); const id = incoming.budgets[0].id
    await actions.removeBudget(category.id)
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { values: { [`budget:${category.id}`]: `source:${id}` } } })
    expect(getState().budgets).toHaveLength(1)
    expect(getState().budgets[0]).toMatchObject({ id, categoryId: category.id, limit: 100, deletedAt: null })
  })
  it('rejects an arbitrary mapping target and retains all committed data', async () => {
    await setup(); const incoming = source(); const before = await readWorkspace('guest')
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { entities: { [`accounts:${incoming.accounts[0].id}`]: uid() } } })).rejects.toThrow()
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('rejects an aggregate overflow rather than discarding data to make the merge fit', async () => {
    const { account } = await setup(); await actions.updateAccount(account.id, { initialBalance: Number.MAX_SAFE_INTEGER })
    const incoming = emptyState(); incoming.accounts.push({ ...stamp(), name: 'New', type: 'cash', initialBalance: 1 })
    const before = await readWorkspace('guest')
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })).rejects.toThrow()
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('does not let bulk recovery silently add a purged transaction when a possible duplicate already exists', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const incoming = structuredClone(getState()); const removedId = incoming.transactions[0].id
    await actions.deleteTransaction(removedId); await actions.purgeOne('transaction', removedId)
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const before = await readWorkspace('guest')
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { recoverDeleted: true } })).rejects.toThrow()
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('does not allow inconsistent keep-local and update choices for two aliases of one local transaction', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const localId = getState().transactions[0].id
    const incoming = source(40); const firstId = incoming.transactions[0].id
    incoming.transactions.push({ ...incoming.transactions[0], id: uid(), amount: 50 })
    const secondId = incoming.transactions[1].id
    const { updateWorkspace } = await import('../src/lib/repository')
    await updateWorkspace('guest', workspace => { workspace.mergeIds = { accounts: {}, categories: {}, budgets: {}, transactions: { [firstId]: localId, [secondId]: localId } } })
    await expect(actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { transactions: { [firstId]: 'incoming', [secondId]: 'local' } } })).rejects.toThrow()
    expect(getState().transactions[0].amount).toBe(25)
  })
  it('merges its own exported original-and-copy snapshot without applying an alias to the wrong row and still recognizes the original source', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const incoming = structuredClone(getState()); const sourceId = incoming.transactions[0].id
    incoming.transactions[0].amount = 40
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { transactions: { [sourceId]: 'copy' } } })
    const copied = await readWorkspace('guest'); const backups = await listBackups('guest')
    expect(copied.state.transactions.map(row => row.amount)).toEqual([25, 40])
    await actions.importJSON(actions.exportJSON(), { mode: 'merge' })
    expect(await readWorkspace('guest')).toEqual(copied)
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge' })
    expect(await readWorkspace('guest')).toEqual(copied)
    expect(await listBackups('guest')).toEqual(backups)
  })
  it('does not let an update to one aliased snapshot row bypass conflict review on another source row', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const incoming = structuredClone(getState()); const originalId = incoming.transactions[0].id
    incoming.transactions[0].amount = 40
    await actions.importJSON(JSON.stringify(incoming), { mode: 'merge', mergeChoices: { transactions: { [originalId]: 'copy' } } })
    const ownExport = structuredClone(getState()); const copyId = ownExport.transactions.find(row => row.id !== originalId)!.id
    ownExport.transactions.find(row => row.id === originalId)!.amount = 30
    await actions.importJSON(JSON.stringify(ownExport), { mode: 'merge', mergeChoices: { transactions: { [originalId]: 'incoming' } } })
    expect(getState().transactions.find(row => row.id === originalId)?.amount).toBe(30)
    expect(getState().transactions.find(row => row.id === copyId)?.amount).toBe(40)
  })
  it('does not collapse an explicitly recovered original into its copy when both identities are in the backup', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const source = structuredClone(getState()); const id = source.transactions[0].id
    source.transactions[0].amount = 40
    await actions.importJSON(JSON.stringify(source), { mode: 'merge', mergeChoices: { transactions: { [id]: 'copy' } } })
    const both = structuredClone(getState())
    await actions.deleteTransaction(id); await actions.purgeOne('transaction', id)
    await actions.importJSON(JSON.stringify(both), { mode: 'merge', mergeChoices: { recoverDeleted: true } })
    expect(getState().transactions.filter(row => !row.deletedAt).map(row => row.amount).sort()).toEqual([25, 40])
    expect(getState().transactions.some(row => row.id === id)).toBe(false)
    expect(getState().purged.transactions).toContain(id)
  })
  it('recognizes distinct identities in an own snapshot even when the aliased copy is marked deleted in the source', async () => {
    const { account, category } = await setup()
    await actions.addTransaction({ type: 'expense', amount: 25, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    const source = structuredClone(getState()); const id = source.transactions[0].id
    source.transactions[0].amount = 40
    await actions.importJSON(JSON.stringify(source), { mode: 'merge', mergeChoices: { transactions: { [id]: 'copy' } } })
    const before = await readWorkspace('guest'); const ownSnapshot = structuredClone(getState())
    ownSnapshot.transactions.find(row => row.id !== id)!.deletedAt = now()
    await actions.importJSON(JSON.stringify(ownSnapshot), { mode: 'merge' })
    expect(await readWorkspace('guest')).toEqual(before)
  })
})
