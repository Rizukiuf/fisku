import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { actions, getGeneration, getScope, getState, initializeFinance, markCloudLoaded, switchWorkspace } from '../src/lib/store'
import { closeDatabase, listBackups, readWorkspace, updateWorkspace } from '../src/lib/repository'
import { fingerprintGuest } from '../src/lib/guestImport'
import { dataOf, uid } from '../src/lib/model'

const user = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
beforeEach(async () => {
  await closeDatabase(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance(); await actions.chooseStart('template')
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })
async function account(id = user) {
  await switchWorkspace(id); markCloudLoaded(getScope(), getGeneration())
  await actions.chooseStart('empty')
}
async function review() {
  const prepared = await actions.inspectGuestImport()
  return actions.prepareImportReview(prepared.json, getScope(), getGeneration(), 'guest')
}

describe('guest import completion and availability', () => {
  it('records the source only after a successful import, keeps guest untouched and hides the same source after reload or local edits', async () => {
    const guest = await readWorkspace('guest'); await account()
    expect(await actions.guestImportAvailable()).toBe(true)
    const prepared = await review()
    expect((await readWorkspace(getScope())).guestImport).toBeUndefined()
    await actions.commitImportReview(prepared, 'merge')
    expect((await readWorkspace(getScope())).guestImport).toBe(await fingerprintGuest(guest.state))
    expect(await readWorkspace('guest')).toEqual(guest)
    expect(await actions.guestImportAvailable()).toBe(false)
    await actions.updateAccount(getState().accounts[0].id, { initialBalance: 10 })
    await switchWorkspace(null); await account()
    expect(await actions.guestImportAvailable()).toBe(false)
    expect(JSON.stringify(dataOf(getState()))).not.toContain('guestImport')
  })
  it('offers changed guest content again and keeps completion scoped to each user', async () => {
    await account(); await actions.commitImportReview(await review(), 'merge')
    await switchWorkspace(null); await actions.addAccount({ name: 'New guest bank', type: 'bank', initialBalance: 5 })
    await account(); expect(await actions.guestImportAvailable()).toBe(true)
    await account(other); expect((await readWorkspace(getScope())).guestImport).toBeUndefined()
    expect(await actions.guestImportAvailable()).toBe(true)
  })
  it('does not offer empty guest or a merge with no finance changes even without a completion receipt', async () => {
    await account(); await actions.applyDefaultTemplate()
    expect(await actions.guestImportAvailable()).toBe(false)
    await switchWorkspace(null); await actions.reset()
    await account(); expect(await actions.guestImportAvailable()).toBe(false)
    await expect(review()).rejects.toThrow('Tidak ada data tamu aktif')
  })
  it('ignores ordering, timestamps, preferences and deleted/purged rows in the source fingerprint', async () => {
    const state = structuredClone(getState()); const original = await fingerprintGuest(state)
    state.accounts.reverse(); state.categories.reverse(); state.accounts[0].updatedAt = '2026-11-17T00:00:00Z'
    state.settings.lang = 'en'; state.purged.accounts.push(uid())
    state.accounts.push({ id: uid(), name: 'Trash', type: 'cash', initialBalance: 0, updatedAt: '2026-11-17T00:00:00Z', deletedAt: '2026-11-17T00:00:00Z' })
    expect(await fingerprintGuest(state)).toBe(original)
    state.accounts[0].initialBalance = 1; expect(await fingerprintGuest(state)).not.toBe(original)
  })
  it('rolls back data, receipt and backup together on write failure and rejects guest Replace', async () => {
    await account(); const prepared = await review(); const before = await readWorkspace(getScope())
    await expect(actions.commitImportReview(prepared, 'replace')).rejects.toThrow('hanya mendukung Gabungkan')
    expect(await readWorkspace(getScope())).toEqual(before)
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    await expect(actions.commitImportReview(prepared, 'merge')).rejects.toThrow('quota')
    expect(await readWorkspace(getScope())).toEqual(before)
    expect(await listBackups(getScope())).toHaveLength(0)
  })
  it('keeps the reviewed source pinned and offers guest edits made while that review was open', async () => {
    await account(); const prepared = await review()
    await updateWorkspace('guest', workspace => { workspace.state.accounts[0].initialBalance = 20 })
    await actions.commitImportReview(prepared, 'merge')
    expect(getState().accounts[0].initialBalance).toBe(0)
    expect(await actions.guestImportAvailable()).toBe(true)
  })
  it('rejects a review after only the completion receipt changes', async () => {
    await account(); const prepared = await review()
    await updateWorkspace(getScope(), workspace => { workspace.guestImport = 'a'.repeat(64) })
    const before = await readWorkspace(getScope())
    await expect(actions.commitImportReview(prepared, 'merge')).rejects.toThrow('Perbarui pratinjau')
    expect(await readWorkspace(getScope())).toEqual(before)
  })
  it.each([{ mode: 'replace' as const }, { restoreAsNew: true }])('rejects destructive options on the dedicated guest API: %j', async options => {
    await account(); const before = await readWorkspace(getScope())
    await expect(actions.importGuest(options)).rejects.toThrow()
    expect(await readWorkspace(getScope())).toEqual(before)
  })
  it('rejects malformed completion metadata without committing it', async () => {
    await account(); const before = await readWorkspace(getScope())
    await expect(updateWorkspace(getScope(), workspace => { workspace.guestImport = 'invalid' })).rejects.toThrow('Status impor tamu tidak valid')
    expect(await readWorkspace(getScope())).toEqual(before)
  })
})
