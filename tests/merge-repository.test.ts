import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { actions, getState, initializeFinance, switchWorkspace } from '../src/lib/store'
import { closeDatabase, listBackups, readWorkspace, updateWorkspace } from '../src/lib/repository'
import { dataOf, emptyState, now, uid } from '../src/lib/model'

beforeEach(async () => {
  await closeDatabase(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance(); await actions.chooseStart('empty')
  await actions.addAccount({ name: 'Bank', type: 'bank', initialBalance: 0 })
  await actions.addCategory({ name: 'Food', type: 'expense' })
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })
function json() {
  const state = emptyState(); const stamp = () => ({ id: uid(), updatedAt: now(), deletedAt: null })
  state.accounts.push({ ...stamp(), name: 'Bank', type: 'bank', initialBalance: 0 })
  state.categories.push({ ...stamp(), name: 'Food', type: 'expense' })
  state.transactions.push({ ...stamp(), type: 'expense', amount: 50, date: '2026-11-16', accountId: state.accounts[0].id, categoryId: state.categories[0].id })
  return JSON.stringify(state)
}
describe('review snapshots and atomic merge', () => {
  it('prepares and cancels a review without writing finance, aliases or backups', async () => {
    const before = await readWorkspace('guest')
    const review = await actions.prepareImportReview(json())
    expect(review.workspace).toEqual(before)
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('rejects a stale review instead of overwriting a newer edit from another tab', async () => {
    const review = await actions.prepareImportReview(json())
    await actions.updateAccount(getState().accounts[0].id, { initialBalance: 75 })
    const edited = await readWorkspace('guest')
    await expect(actions.commitImportReview(review, 'merge')).rejects.toThrow('Perbarui pratinjau')
    expect(await readWorkspace('guest')).toEqual(edited)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('also invalidates a review when aliases alone change', async () => {
    const review = await actions.prepareImportReview(json())
    await updateWorkspace('guest', workspace => { workspace.mergeIds = { accounts: { [uid()]: getState().accounts[0].id }, categories: {}, budgets: {}, transactions: {} } })
    const before = await readWorkspace('guest')
    await expect(actions.commitImportReview(review, 'merge')).rejects.toThrow('Perbarui pratinjau')
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('accepts a review after a timestamp/checkpoint-only heartbeat and preserves the new checkpoint', async () => {
    const review = await actions.prepareImportReview(json())
    await updateWorkspace('guest', workspace => { workspace.lastSync = '2026-11-16T01:00:00.000Z' })
    await actions.commitImportReview(review, 'merge')
    const after = await readWorkspace('guest')
    expect(after.state.transactions).toHaveLength(1)
    expect(after.lastSync).toBe('2026-11-16T01:00:00.000Z')
  })
  it('rolls back the candidate, alias mapping and backup when a durable write fails', async () => {
    const review = await actions.prepareImportReview(json()); const before = await readWorkspace('guest')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new Error('Merge quota') })
    await expect(actions.commitImportReview(review, 'merge')).rejects.toThrow('Merge quota')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(getState()).toEqual(before.state)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('rejects a review from an earlier owner generation even after returning to that same scope', async () => {
    const review = await actions.prepareImportReview(json())
    await switchWorkspace(uid()); await switchWorkspace(null)
    const before = await readWorkspace('guest')
    await expect(actions.commitImportReview(review, 'merge')).rejects.toThrow('Sesi berubah')
    expect(await readWorkspace('guest')).toEqual(before)
  })
  it('retains the pending operation and its original snapshot while committing new local data', async () => {
    await updateWorkspace('guest', workspace => { workspace.pending = { id: uid(), revision: 0, data: dataOf(workspace.state) } })
    const before = await readWorkspace('guest'); const review = await actions.prepareImportReview(json())
    await actions.commitImportReview(review, 'merge')
    const after = await readWorkspace('guest')
    expect(after.pending).toEqual(before.pending)
    expect(after.state.transactions).toHaveLength(1)
    expect(after.pending!.data.transactions).toHaveLength(0)
    expect((await listBackups('guest'))[0].state).toEqual(before.state)
  })
  it('does not write or back up an exact identity-preserving repeat merge', async () => {
    const before = await readWorkspace('guest')
    await actions.importJSON(actions.exportJSON(), { mode: 'merge' })
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('rejects an invalid mode rather than falling back to destructive replace', async () => {
    const before = await readWorkspace('guest')
    await expect(actions.importJSON(json(), { mode: 'invalid' as 'merge' })).rejects.toThrow('Mode impor')
    expect(await readWorkspace('guest')).toEqual(before)
  })
})
