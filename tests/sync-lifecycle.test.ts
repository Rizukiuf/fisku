import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { actions, getGeneration, getScope, getState, getWorkspace, initializeFinance, markCloudLoaded, switchWorkspace } from '../src/lib/store'
import { closeDatabase, readWorkspace, updateWorkspace } from '../src/lib/repository'
import * as repository from '../src/lib/repository'
import { dataOf } from '../src/lib/model'
import { resolveSyncConflict, runSync } from '../src/lib/sync'
import { getSyncStatus, setSyncStatus } from '../src/lib/syncStatus'

const api = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), read: vi.fn(), push: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({
  cloudConfigured: true,
  supabase: {
    auth: { getSession: api.session, getUser: api.user },
    rpc(name: string, args: unknown) {
      const builder = { setHeader: () => builder, abortSignal: () => name === 'finance_read' ? api.read() : api.push(args) }
      return builder
    },
  },
}))
const user = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const credentials = () => ({ data: { session: { access_token: 'synthetic-token', user: { id: user } } }, error: null })
let remote: ReturnType<typeof dataOf>
beforeEach(async () => {
  vi.resetAllMocks(); await closeDatabase()
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('localStorage', { getItem: () => null })
  vi.stubGlobal('navigator', { onLine: true })
  await initializeFinance(); await switchWorkspace(user); markCloudLoaded(getScope(), getGeneration())
  await actions.chooseStart('template')
  remote = dataOf(getState())
  await updateWorkspace(getScope(), workspace => { workspace.base = structuredClone(remote); workspace.revision = 1 })
  await switchWorkspace(user); markCloudLoaded(getScope(), getGeneration())
  api.session.mockResolvedValue(credentials()); api.user.mockResolvedValue({ data: { user: { id: user } }, error: null })
  api.read.mockImplementation(async () => ({ data: { revision: 1, state: structuredClone(remote) }, error: null }))
  api.push.mockResolvedValue({ data: { revision: 2 }, error: null })
  setSyncStatus({ status: 'idle', error: null, lastSync: null })
})
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await closeDatabase() })

describe('sync request lifecycle', () => {
  it.each(['local edit', 'new conflict revision', 'new session', 'new baseline'])('rejects a conflict decision after the comparison changes (%s)', async change => {
    await actions.updateAccount(getState().accounts[0].id, { initialBalance: 200 })
    remote.accounts[0].initialBalance = 100
    api.read.mockResolvedValue({ data: { revision: 2, state: remote }, error: null })
    await expect(runSync()).rejects.toThrow('Konflik perubahan')
    const reviewed = { ...structuredClone(getWorkspace()!), generation: getGeneration() }
    if (change === 'local edit') await actions.updateAccount(getState().accounts[0].id, { initialBalance: 300 })
    else if (change === 'new conflict revision') await updateWorkspace(getScope(), workspace => { workspace.conflict!.revision = 3 })
    else if (change === 'new session') await switchWorkspace(user)
    else await updateWorkspace(getScope(), workspace => { workspace.base.accounts[0].initialBalance = 200 })
    await expect(resolveSyncConflict('remote', reviewed)).rejects.toThrow('Data konflik berubah')
    const saved = await readWorkspace(getScope())
    expect(saved.state.accounts[0].initialBalance).toBe(change === 'local edit' ? 300 : 200)
    expect(saved.conflict).toBeTruthy()
    expect(api.push).not.toHaveBeenCalled()
  })
  it('does not immediately restart an overlapping request after a data conflict', async () => {
    await actions.updateAccount(getState().accounts[0].id, { initialBalance: 200 })
    remote.accounts[0].initialBalance = 100
    api.read.mockResolvedValue({ data: { revision: 2, state: remote }, error: null })
    const first = runSync(); const overlapping = runSync()
    const results = await Promise.allSettled([first, overlapping])
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(api.session).toHaveBeenCalledTimes(1)
    expect(getWorkspace()?.conflict).toBeTruthy()
    expect(getSyncStatus().status).toBe('error')
    await expect(runSync()).rejects.toThrow('Konflik perubahan')
    expect(api.session).toHaveBeenCalledTimes(1)
  })
  it('bounds a stalled session wait and ignores its result when it eventually arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let release!: (value: ReturnType<typeof credentials>) => void
    api.session.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const before = await readWorkspace(getScope())
    const result = runSync().catch(error => error)
    await vi.advanceTimersByTimeAsync(15001)
    expect(getSyncStatus().status).toBe('error')
    expect((await result).message).toContain('memeriksa sesi')
    release(credentials()); await Promise.resolve(); await Promise.resolve()
    expect(api.user).not.toHaveBeenCalled(); expect(api.read).not.toHaveBeenCalled()
    expect(await readWorkspace(getScope())).toEqual(before)
  })
  it('preserves the pending operation when a push never responds and permits a clean manual retry', async () => {
    await actions.updateAccount(getState().accounts[0].id, { initialBalance: 50 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let reached!: () => void; const started = new Promise<void>(resolve => { reached = resolve })
    let release!: (value: unknown) => void
    api.push.mockImplementationOnce(() => { reached(); return new Promise(resolve => { release = resolve }) })
    const first = runSync().catch(error => error)
    await started
    const pending = (await readWorkspace(getScope())).pending
    await vi.advanceTimersByTimeAsync(15001)
    expect(getSyncStatus().status).toBe('error')
    expect((await first).message).toContain('mengirim perubahan')
    expect((await readWorkspace(getScope())).pending).toEqual(pending)
    api.read.mockResolvedValue({ data: { revision: 2, state: pending!.data }, error: null })
    await runSync()
    expect(api.push.mock.calls[1][0].p_operation_id).toBe(pending!.id)
    release({ data: { revision: 2 }, error: null }); await Promise.resolve(); await Promise.resolve()
    expect(getWorkspace()?.pending).toBeNull(); expect(getSyncStatus().status).toBe('ok')
    expect(getState().accounts[0].initialBalance).toBe(50)
  })
  it('does not use an overlapping call to bypass backoff after a network failure', async () => {
    api.read.mockResolvedValue({ data: null, error: new Error('network unavailable') })
    const results = await Promise.allSettled([runSync(), runSync()])
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(api.session).toHaveBeenCalledTimes(1)
    expect(getSyncStatus().error).toBe('network unavailable')
  })
  it('does not publish a previous owner timeout or late response into the next owner', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let release!: (value: ReturnType<typeof credentials>) => void
    api.session.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = runSync().catch(error => error)
    await Promise.resolve(); await Promise.resolve()
    await switchWorkspace('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    setSyncStatus({ status: 'ok', error: null, lastSync: '2026-11-17T00:00:00Z' })
    const before = getSyncStatus()
    await vi.advanceTimersByTimeAsync(15001); await first
    release(credentials()); await Promise.resolve(); await Promise.resolve()
    expect(getSyncStatus()).toEqual(before)
    expect(api.user).not.toHaveBeenCalled(); expect(getState().accounts).toHaveLength(0)
  })
  it('limits the whole attempt even when each completed stage is under the per-stage limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    api.session.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(credentials()), 10000)))
    api.user.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({ data: { user: { id: user } }, error: null }), 10000)))
    let reached!: () => void; const reading = new Promise<void>(resolve => { reached = resolve })
    api.read.mockImplementationOnce(() => { reached(); return new Promise(() => {}) })
    const result = runSync().catch(error => error)
    await vi.advanceTimersByTimeAsync(20000); await reading
    await vi.advanceTimersByTimeAsync(10001)
    expect((await result).message).toContain('membaca data cloud')
    expect(getSyncStatus().status).toBe('error')
    expect(getWorkspace()?.lastSync).toBeNull()
  })
  it('rejects an expired queued commit instead of overwriting a local edit made after timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    remote.accounts[0].initialBalance = 100
    api.read.mockResolvedValue({ data: { revision: 2, state: remote }, error: null })
    let reached!: () => void; const waiting = new Promise<void>(resolve => { reached = resolve })
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    let finished!: () => void; const completed = new Promise<void>(resolve => { finished = resolve })
    const update = repository.updateWorkspace
    vi.spyOn(repository, 'updateWorkspace').mockImplementationOnce(async (...args) => {
      reached(); await gate
      try { return await update(...args) } finally { finished() }
    })
    const result = runSync().catch(error => error)
    await waiting; await vi.advanceTimersByTimeAsync(15001)
    expect((await result).message).toContain('menyimpan hasil lokal')
    await actions.updateAccount(getState().accounts[0].id, { initialBalance: 300 })
    const before = await readWorkspace(getScope())
    release(); await completed
    expect(await readWorkspace(getScope())).toEqual(before)
    expect(getState().accounts[0].initialBalance).toBe(300)
    expect(api.push).not.toHaveBeenCalled()
  })
})
