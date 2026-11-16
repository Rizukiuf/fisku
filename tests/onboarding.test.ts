import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { actions, dismissOnboarding, getGeneration, getScope, getState, getWorkspace, hasLoadedCloud, initializeFinance, isDirty, markCloudLoaded, shouldPromptOnboarding, switchWorkspace } from '../src/lib/store'
import { checkWorkspace, closeDatabase, listBackups, newWorkspace, openDatabase, readWorkspace, updateWorkspace } from '../src/lib/repository'
import { createSeed, emptyState, uid } from '../src/lib/model'
import { resetToEmpty } from '../src/lib/reset'

beforeEach(async () => {
  await closeDatabase(); vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', { getItem: () => null })
  await initializeFinance()
})
afterEach(async () => { vi.restoreAllMocks(); await closeDatabase() })

describe('durable first-use choice', () => {
  it('saves an empty choice without finance changes, backups, or dirty sync and retains it after reload/reset', async () => {
    expect(shouldPromptOnboarding()).toBe(true)
    const before = structuredClone(getState())
    expect(await actions.chooseStart('empty')).toBe(true)
    expect(getState()).toEqual(before)
    expect(isDirty()).toBe(false)
    expect(shouldPromptOnboarding()).toBe(false)
    expect(await listBackups('guest')).toHaveLength(0)
    const workspace = await readWorkspace('guest')
    await switchWorkspace(null); expect(await actions.reset()).toBe(false)
    expect(await readWorkspace('guest')).toEqual(workspace)
    expect(getWorkspace()?.onboarding).toBe('empty')
  })
  it('commits a template and its choice atomically and ignores a second first-use choice', async () => {
    expect(await actions.chooseStart('template')).toBe(true)
    expect(getWorkspace()?.onboarding).toBe('template')
    expect(getState().accounts).toHaveLength(3)
    expect(getState().categories).toHaveLength(7)
    const before = await readWorkspace('guest')
    expect(await actions.chooseStart('empty')).toBe(false)
    expect(await readWorkspace('guest')).toEqual(before)
    await actions.reset(); await switchWorkspace(null)
    expect(getState().accounts.every(row => row.deletedAt)).toBe(true)
    expect(shouldPromptOnboarding()).toBe(false)
  })
  it.each(['empty', 'template'] as const)('rolls back a failed %s choice including its metadata', async choice => {
    const before = await readWorkspace('guest')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new Error('Quota failure') })
    await expect(actions.chooseStart(choice)).rejects.toThrow('Quota failure')
    expect(await readWorkspace('guest')).toEqual(before)
    expect(shouldPromptOnboarding()).toBe(true)
    expect(getState().accounts).toHaveLength(0)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('dismisses only this visit without persisting a decision or adding data', async () => {
    const before = await readWorkspace('guest')
    dismissOnboarding()
    expect(shouldPromptOnboarding()).toBe(false)
    expect(await readWorkspace('guest')).toEqual(before)
    await switchWorkspace(null)
    expect(shouldPromptOnboarding()).toBe(true)
  })
  it('records reset intent even for an unused empty workspace and subsequent resets do not write', async () => {
    expect(await actions.reset()).toBe(false)
    expect(getWorkspace()?.onboarding).toBe('empty')
    expect(shouldPromptOnboarding()).toBe(false)
    const reset = await readWorkspace('guest')
    for (let i = 0; i < 5; i++) expect(await actions.reset()).toBe(false)
    expect(await readWorkspace('guest')).toEqual(reset)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('does not overwrite a workspace changed before a delayed choice is submitted', async () => {
    const original = getWorkspace()!
    await updateWorkspace('guest', workspace => { workspace.state = createSeed() })
    const before = await readWorkspace('guest')
    expect(await actions.chooseStart('template', original.scope, getGeneration())).toBe(false)
    expect(await readWorkspace('guest')).toEqual(before)
    expect(getWorkspace()?.onboarding).toBe('existing')
    expect(shouldPromptOnboarding()).toBe(false)
  })
  it.each([['empty', 'template'], ['template', 'empty']] as const)('serializes competing %s/%s decisions so only the first is applied', async (first, second) => {
    expect(await Promise.all([actions.chooseStart(first), actions.chooseStart(second)])).toEqual([true, false])
    expect(getWorkspace()?.onboarding).toBe(first)
    expect(getState().accounts).toHaveLength(first === 'template' ? 3 : 0)
    expect(await listBackups('guest')).toHaveLength(0)
  })
  it('waits for this owner and generation to load cloud data and keeps guest/user choices separate', async () => {
    await actions.chooseStart('empty')
    await switchWorkspace(uid())
    const ownerA = getScope(); const tokenA = getGeneration()
    expect(hasLoadedCloud()).toBe(false)
    expect(shouldPromptOnboarding()).toBe(false)
    await expect(actions.chooseStart('template')).rejects.toThrow('Tunggu pemuatan')
    await expect(actions.applyDefaultTemplate()).rejects.toThrow('Tunggu pemuatan')
    markCloudLoaded('guest', tokenA); markCloudLoaded(ownerA, tokenA - 1)
    expect(hasLoadedCloud()).toBe(false)
    markCloudLoaded(ownerA, tokenA)
    expect(shouldPromptOnboarding()).toBe(true)
    await actions.chooseStart('empty')
    await switchWorkspace(uid())
    markCloudLoaded(ownerA, tokenA)
    expect(hasLoadedCloud()).toBe(false)
    await expect(actions.chooseStart('template', ownerA, tokenA)).rejects.toThrow('Sesi berubah')
    markCloudLoaded(getScope(), getGeneration())
    await actions.chooseStart('template')
    expect((await readWorkspace(ownerA)).onboarding).toBe('empty')
    expect((await readWorkspace('guest')).onboarding).toBe('empty')
    expect(getState().accounts).toHaveLength(3)
  })
  it('requires a fresh cloud load after each session entry even if lastSync exists', async () => {
    const userId = uid(); await switchWorkspace(userId)
    await updateWorkspace(getScope(), workspace => { workspace.lastSync = new Date().toISOString() })
    await switchWorkspace(userId)
    expect(hasLoadedCloud()).toBe(false)
    expect(shouldPromptOnboarding()).toBe(false)
    markCloudLoaded(getScope(), getGeneration())
    expect(shouldPromptOnboarding()).toBe(true)
  })
  it('adapts old data and reset/purged/cloud workspaces without prompting or changing finance', async () => {
    const states = [createSeed(), resetToEmpty(createSeed()).state, emptyState(), emptyState()]
    states[2].purged.accounts.push(uid())
    for (let i = 0; i < states.length; i++) {
      const owner = uid(); const workspace = newWorkspace(`user:${owner}`, states[i])
      delete workspace.onboarding
      if (i === 3) workspace.revision = 1
      const db = await openDatabase()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('workspaces', 'readwrite')
        tx.objectStore('workspaces').put(workspace)
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
      })
      await switchWorkspace(owner)
      expect(getState()).toEqual(states[i])
      expect(getWorkspace()?.onboarding).toBe('existing')
      expect(shouldPromptOnboarding()).toBe(false)
      const stored = await readWorkspace(workspace.scope)
      await switchWorkspace(owner)
      expect(await readWorkspace(workspace.scope)).toEqual(stored)
    }
  })
  it('rejects invalid saved choice metadata without replacing the original data', () => {
    const workspace = { ...newWorkspace('guest'), onboarding: 'invalid' }
    expect(() => checkWorkspace(workspace, 'guest')).toThrow('Status penyiapan')
    expect(workspace.onboarding).toBe('invalid')
  })
})
