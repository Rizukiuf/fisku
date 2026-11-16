import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { actions, getState, initializeFinance, isDirty, switchWorkspace } from '../src/lib/store'
import { closeDatabase, listBackups, readWorkspace, updateWorkspace } from '../src/lib/repository'
import { createSeed, dataOf, entityKeys, uid } from '../src/lib/model'

beforeEach(async () => {
  await closeDatabase(); vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance()
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })

describe('empty workspaces and explicit templates', () => {
  it('starts guest and users empty without pending changes and stays empty after reload', async () => {
    for (const owner of [null, uid()]) {
      await switchWorkspace(owner)
      for (const key of entityKeys) expect(getState()[key]).toHaveLength(0)
      expect(isDirty()).toBe(false)
      const before = await readWorkspace(owner ? `user:${owner}` : 'guest')
      await closeDatabase(); await switchWorkspace(owner)
      expect(await readWorkspace(before.scope)).toEqual(before)
    }
  })
  it('adds the template only by an explicit command and retains preferences', async () => {
    await actions.updateSettings({ theme: 'dark', lang: 'en' })
    await actions.applyDefaultTemplate()
    expect(getState().accounts).toHaveLength(3)
    expect(getState().categories).toHaveLength(7)
    expect(getState().accounts.every(a => a.initialBalance === 0)).toBe(true)
    expect(getState().settings).toEqual({ theme: 'dark', lang: 'en' })
    expect(await listBackups('guest')).toHaveLength(0)
    await switchWorkspace(uid())
    expect(getState().accounts).toHaveLength(0)
    await switchWorkspace(null)
    expect(getState().accounts).toHaveLength(3)
  })
  it('does not recreate defaults after deletion, reset, or reload', async () => {
    await actions.applyDefaultTemplate()
    const accountId = getState().accounts[0].id; const categoryId = getState().categories[0].id
    await actions.deleteAccount(accountId); await actions.deleteCategory(categoryId)
    const before = structuredClone(getState())
    await actions.reset()
    for (const key of entityKeys) expect(getState()[key].every(row => row.deletedAt)).toBe(true)
    expect(getState().accounts.map(a => a.id)).toEqual(before.accounts.map(a => a.id))
    expect(getState().categories.map(c => c.id)).toEqual(before.categories.map(c => c.id))
    expect(getState().accounts[0]).toEqual(before.accounts[0])
    const reset = await readWorkspace('guest')
    await switchWorkspace(null); expect(await actions.reset()).toBe(false)
    expect(await readWorkspace('guest')).toEqual(reset)
    expect(await listBackups('guest')).toHaveLength(1)
  })
  it('can explicitly add a new template after reset without reviving trashed or purged IDs', async () => {
    await actions.applyDefaultTemplate()
    const old = structuredClone(getState())
    await actions.deleteAccount(old.accounts[0].id); await actions.purgeOne('account', old.accounts[0].id)
    await actions.deleteCategory(old.categories[0].id); await actions.purgeOne('category', old.categories[0].id)
    await actions.reset()
    const trash = structuredClone(getState())
    await actions.applyDefaultTemplate()
    expect(getState().accounts.filter(a => !a.deletedAt)).toHaveLength(3)
    expect(getState().categories.filter(c => !c.deletedAt)).toHaveLength(7)
    expect(getState().accounts.filter(a => !a.deletedAt).every(a => !old.accounts.some(b => b.id === a.id))).toBe(true)
    expect(getState().categories.filter(c => !c.deletedAt).every(c => !old.categories.some(b => b.id === c.id))).toBe(true)
    expect(getState().accounts.filter(a => a.deletedAt)).toEqual(trash.accounts)
    expect(getState().categories.filter(c => c.deletedAt)).toEqual(trash.categories)
    expect(getState().purged).toEqual(trash.purged)
  })
  it('rejects templates on a nonempty workspace and serializes simultaneous requests', async () => {
    const results = await Promise.allSettled([actions.applyDefaultTemplate(), actions.applyDefaultTemplate()])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(getState().accounts).toHaveLength(3)
    const before = await readWorkspace('guest')
    await expect(actions.applyDefaultTemplate()).rejects.toThrow('tidak ada data keuangan aktif')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('rolls back a failed template write completely', async () => {
    const before = await readWorkspace('guest')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new Error('Storage full') })
    await expect(actions.applyDefaultTemplate()).rejects.toThrow('Storage full')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(getState()).toEqual(before.state)
  })
  it('requires resolving a cloud conflict before adding a template', async () => {
    await updateWorkspace('guest', workspace => { workspace.conflict = { remote: dataOf(createSeed()), revision: 1, ids: ['data'] } })
    const before = await readWorkspace('guest')
    await expect(actions.applyDefaultTemplate()).rejects.toThrow('Selesaikan konflik')
    expect(await readWorkspace('guest')).toEqual(before)
  })
})
