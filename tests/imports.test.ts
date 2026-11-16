import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { actions, accountBalance, getGeneration, getScope, getState, initializeFinance, markCloudLoaded, switchWorkspace, totalBalance } from '../src/lib/store'
import { closeDatabase, listBackups, readWorkspace, updateWorkspace } from '../src/lib/repository'
import { createSeed, dataOf, decodeState, entityKeys, uid } from '../src/lib/model'
import { restoreImport } from '../src/lib/imports'

beforeEach(async () => {
  await closeDatabase(); vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance(); await actions.chooseStart('template')
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })

async function fixture() {
  const state = getState(); const [from, to] = state.accounts
  const income = state.categories.find(c => c.type === 'income')!.id
  const expense = state.categories.find(c => c.type === 'expense')!.id
  await actions.addTransaction({ type: 'income', accountId: from.id, categoryId: income, amount: 100, date: '2026-11-16' })
  await actions.addTransaction({ type: 'expense', accountId: from.id, categoryId: expense, amount: 30, date: '2026-11-16' })
  await actions.addTransaction({ type: 'transfer', accountId: from.id, targetAccountId: to.id, amount: 20, date: '2026-11-16' })
  await actions.addTransaction({ type: 'expense', accountId: from.id, categoryId: expense, amount: 999, date: '2026-11-16' })
  await actions.deleteTransaction(getState().transactions[0].id)
  await actions.setBudget(expense, 300)
  await actions.updateSettings({ theme: 'dark', lang: 'en' })
  const original = structuredClone(getState()); const json = actions.exportJSON()
  await actions.reset(); await actions.purgeDeleted()
  return { original, json, before: await readWorkspace('guest') }
}

describe('explicit recovery after permanent deletion', () => {
  it('detects the purge collision and still rejects an ordinary identity-preserving import', async () => {
    const { json, before } = await fixture()
    expect(await actions.inspectImportJSON(json)).toEqual({ purgedRows: 15 })
    await expect(actions.importJSON(json)).rejects.toThrow('dimusnahkan')
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('restores the entire graph with new IDs, exact balances, preferences, deleted rows, and old purge markers', async () => {
    const { json, original, before } = await fixture()
    await actions.importJSON(json, { restoreAsNew: true })
    const state = getState(); const workspace = await readWorkspace('guest')
    expect(state.purged).toEqual(before.state.purged)
    expect(state.settings).toEqual(original.settings)
    for (const key of entityKeys) {
      expect(state[key]).toHaveLength(original[key].length)
      expect(state[key].every(row => !original[key].some(old => old.id === row.id))).toBe(true)
    }
    expect(state.transactions.filter(row => row.deletedAt)).toHaveLength(1)
    expect(totalBalance(state.accounts, state.transactions)).toBe(70)
    expect(state.accounts.map(account => accountBalance(account, state.transactions))).toEqual([50, 20, 0])
    const transfer = state.transactions.find(tx => tx.type === 'transfer')!
    expect(transfer.accountId).toBe(workspace.importIds!.accounts[original.accounts[0].id])
    expect(transfer.targetAccountId).toBe(workspace.importIds!.accounts[original.accounts[1].id])
    expect(transfer.categoryId).toBeUndefined()
    expect(state.budgets[0].categoryId).toBe(workspace.importIds!.categories[original.budgets[0].categoryId])
    expect(decodeState(state)).toEqual(state)
    expect((await listBackups('guest')).some(backup => JSON.stringify(backup.state) === JSON.stringify(before.state))).toBe(true)
    expect(JSON.parse(actions.exportJSON()).data.importIds).toBeUndefined()
  })
  it('reuses recovery identities after reload and does not create trash, writes or backups for the same repeated restore', async () => {
    const { json } = await fixture()
    await actions.importJSON(json, { restoreAsNew: true })
    const restored = await readWorkspace('guest'); const backups = await listBackups('guest')
    await closeDatabase(); await switchWorkspace(null)
    for (let i = 0; i < 5; i++) await actions.importJSON(json, { restoreAsNew: true })
    expect(await readWorkspace('guest')).toEqual(restored)
    expect(await listBackups('guest')).toEqual(backups)
  })
  it('allocates replacement identities again if an earlier recovery has also been permanently deleted', async () => {
    const { json, before } = await fixture()
    await actions.importJSON(json, { restoreAsNew: true })
    const first = structuredClone(getState())
    await actions.reset(); await actions.purgeDeleted()
    await actions.importJSON(json, { restoreAsNew: true })
    for (const key of entityKeys) {
      expect(getState()[key].every(row => !first[key].some(old => old.id === row.id))).toBe(true)
      expect(before.state.purged[key].every(id => getState().purged[key].includes(id))).toBe(true)
      expect(first[key].every(row => getState().purged[key].includes(row.id))).toBe(true)
    }
  })
  it('rolls back finance, mapping and backup together on a failed durable write', async () => {
    const { json, before } = await fixture(); const backups = await listBackups('guest')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new Error('Recovery quota') })
    await expect(actions.importJSON(json, { restoreAsNew: true })).rejects.toThrow('Recovery quota')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(getState()).toEqual(before.state)
    expect(await listBackups('guest')).toEqual(backups)
  })
  it('handles a purged budget with an existing category without duplicate budget-category identities', async () => {
    const category = getState().categories.find(c => c.type === 'expense')!.id
    await actions.setBudget(category, 200)
    const json = actions.exportJSON(); const budgetId = getState().budgets[0].id
    await actions.removeBudget(category); await actions.purgeOne('budget', budgetId)
    expect((await actions.inspectImportJSON(json)).purgedRows).toBe(1)
    await actions.importJSON(json, { restoreAsNew: true })
    expect(getState().budgets).toHaveLength(1)
    expect(getState().budgets[0].id).not.toBe(budgetId)
    expect(getState().budgets[0].categoryId).not.toBe(category)
    expect(getState().categories.find(c => c.id === category)?.deletedAt).toBeTruthy()
    expect(getState().purged.budgets).toContain(budgetId)
  })
  it('does not apply foreign deletion markers to unrelated local history in recovery mode', () => {
    const current = createSeed(); const categoryId = current.categories[0].id
    current.transactions.push({ id: uid(), type: 'income', accountId: current.accounts[0].id, categoryId, amount: 100, date: '2026-11-16', updatedAt: new Date().toISOString(), deletedAt: null })
    const imported = createSeed(); const removedId = imported.accounts.shift()!.id
    imported.purged.accounts.push(removedId)
    const result = restoreImport(current, decodeState(imported)).state
    expect(result.purged).toEqual(current.purged)
    expect(result.accounts.find(row => row.id === removedId)?.deletedAt).toBeTruthy()
    expect(result.transactions.find(row => row.id === current.transactions[0].id)?.deletedAt).toBeTruthy()
    expect(result.accounts.filter(row => !row.deletedAt)).toHaveLength(2)
  })
  it('uses a fresh graph if a different backup changes category type and makes reuse incompatible with older trash', async () => {
    const { original, json } = await fixture()
    await actions.importJSON(json, { restoreAsNew: true })
    const first = await readWorkspace('guest')
    const changed = structuredClone(original); const categoryId = changed.categories[0].id
    changed.categories[0].type = 'expense'
    changed.transactions = [{ id: uid(), type: 'expense', accountId: changed.accounts[0].id, categoryId, amount: 5, date: '2026-11-16', updatedAt: new Date().toISOString(), deletedAt: null }]
    await actions.importJSON(JSON.stringify(changed), { restoreAsNew: true })
    const second = await readWorkspace('guest')
    expect(second.importIds!.categories[categoryId]).not.toBe(first.importIds!.categories[categoryId])
    expect(getState().categories.find(row => row.id === first.importIds!.categories[categoryId])?.type).toBe('income')
    expect(getState().transactions.filter(row => !row.deletedAt)).toHaveLength(1)
    expect(decodeState(getState())).toEqual(getState())
  })
  it('binds inspection and restore commits to the owner/generation that selected the file', async () => {
    const { json, before } = await fixture(); const token = getGeneration()
    await switchWorkspace(uid()); const other = structuredClone(getState())
    await expect(actions.inspectImportJSON(json, 'guest', token)).rejects.toThrow('Sesi berubah')
    await expect(actions.importJSON(json, { restoreAsNew: true, expectedScope: 'guest', expectedGeneration: token })).rejects.toThrow('Sesi berubah')
    expect(getState()).toEqual(other)
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('does not silently change a normal import into recovery when a purge occurs after inspection', async () => {
    const json = actions.exportJSON()
    expect((await actions.inspectImportJSON(json)).purgedRows).toBe(0)
    await actions.reset(); await actions.purgeDeleted()
    const before = await readWorkspace('guest')
    await expect(actions.importJSON(json)).rejects.toThrow('dimusnahkan')
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('waits for the first cloud read and blocks an import while a cloud conflict is unresolved', async () => {
    const json = actions.exportJSON()
    await switchWorkspace(uid()); const owner = getScope()
    const before = await readWorkspace(owner)
    await expect(actions.inspectImportJSON(json)).rejects.toThrow('Tunggu pemuatan')
    await expect(actions.importJSON(json, { restoreAsNew: true })).rejects.toThrow('Tunggu pemuatan')
    expect(await readWorkspace(owner)).toEqual(before)
    markCloudLoaded(owner, getGeneration())
    await updateWorkspace(owner, workspace => { workspace.conflict = { remote: dataOf(createSeed()), revision: 1, ids: ['data'] } })
    const conflict = await readWorkspace(owner)
    await expect(actions.inspectImportJSON(json)).rejects.toThrow('Selesaikan konflik')
    await expect(actions.importJSON(json, { restoreAsNew: true })).rejects.toThrow('Selesaikan konflik')
    expect(await readWorkspace(owner)).toEqual(conflict)
  })
  it('allows local recovery from an acknowledged cached workspace without a new network read', async () => {
    const json = actions.exportJSON(); const user = uid()
    await switchWorkspace(user)
    await updateWorkspace(getScope(), workspace => { workspace.lastSync = new Date().toISOString() })
    await switchWorkspace(user)
    expect((await actions.inspectImportJSON(json)).purgedRows).toBe(0)
    await actions.importJSON(json, { restoreAsNew: true })
    expect(getState().accounts).toHaveLength(3)
  })
  it('can inspect and recover guest data into an owner with purged seed IDs without changing the guest workspace', async () => {
    const guest = await readWorkspace('guest')
    await switchWorkspace(uid()); markCloudLoaded(getScope(), getGeneration())
    await actions.applyDefaultTemplate(); await actions.reset(); await actions.purgeDeleted()
    const prepared = await actions.inspectGuestImport()
    expect(prepared.purgedRows).toBe(10)
    expect(JSON.parse(prepared.json)).toEqual(guest.state)
    await actions.importGuest({ mergeChoices: { recoverDeleted: true } })
    expect(getState().accounts).toHaveLength(3)
    expect(getState().accounts.every(row => !guest.state.accounts.some(old => old.id === row.id))).toBe(true)
    expect(await readWorkspace('guest')).toEqual(guest)
  })
  it.each(['{}', '{bad', '{"format":"fisku-backup","version":99}', JSON.stringify({ ...createSeed(), transactions: [{ id: uid() }] })])('rejects invalid recovery input %s without writes', async json => {
    const before = await readWorkspace('guest')
    await expect(actions.importJSON(json, { restoreAsNew: true })).rejects.toThrow()
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('rejects invalid saved recovery mappings atomically', async () => {
    const before = await readWorkspace('guest')
    await expect(updateWorkspace('guest', workspace => { workspace.importIds = { accounts: { invalid: 'invalid' }, categories: {}, transactions: {}, budgets: {} } })).rejects.toThrow('Identitas pemulihan')
    expect(await readWorkspace('guest')).toEqual(before)
  })
})
