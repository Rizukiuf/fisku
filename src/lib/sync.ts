import { supabase, cloudConfigured } from './supabase'
import { commitWorkspace, getGeneration, getScope, getWorkspace, isDirty, isReady, refreshWorkspace, markCloudLoaded } from './store'
import { dataOf, requireValue, type State } from './model'
import { readWorkspace, type Workspace } from './repository'
import { DataConflict, reconcile, same } from './reconcile'
import { decodeSnapshot, synchronize } from './syncEngine'
import { setSyncStatus } from './syncStatus'
import { withSyncDeadline } from './syncDeadline'

type Flight = { generation: number; promise: Promise<void>; again: boolean }
const flights = new Map<string, Flight>()
export async function runSync(_full = false): Promise<void> {
  if (!cloudConfigured || !supabase || !isReady() || !getScope().startsWith('user:')) return
  const scope = getScope(); const token = getGeneration(); const userId = scope.slice(5)
  const conflict = getWorkspace()?.conflict
  if (conflict) {
    const error = new DataConflict(conflict.ids)
    setSyncStatus({ status: 'error', error: error.message })
    throw error
  }
  const running = flights.get(scope)
  if (running?.generation === token) {
    running.again = true
    return running.promise
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) { setSyncStatus({ status: 'offline' }); return }
  const ownerActive = () => isReady() && scope === getScope() && token === getGeneration()
  const db = supabase
  setSyncStatus({ status: 'syncing', error: null, autoRetryBlocked: false, phase: null, startedAt: performance.now() })
  const promise = withSyncDeadline(async deadline => {
    const active = () => ownerActive() && !deadline.signal.aborted
    const checkActive = () => { deadline.check(); requireValue(ownerActive(), 'Sesi berubah; hasil sinkronisasi tidak diterapkan.') }
    const { data: sessionData, error: sessionError } = await deadline.step('memeriksa sesi', () => db.auth.getSession())
    checkActive()
    if (sessionError) throw sessionError
    const accessToken = sessionData.session?.access_token
    if (!accessToken || sessionData.session?.user.id !== userId) throw new Error('Sesi pengguna berubah. Masuk kembali sebelum sinkronisasi.')
    const { data, error } = await deadline.step('memvalidasi pengguna', () => db.auth.getUser(accessToken))
    checkActive()
    if (error) throw error
    if (data.user?.id !== userId) throw new Error('Sesi pengguna berubah. Masuk kembali sebelum sinkronisasi.')
    const rpc = async (name: 'finance_read' | 'finance_push', args: Record<string, unknown> = {}) => {
      return deadline.step(name === 'finance_read' ? 'membaca data cloud' : 'mengirim perubahan', async () => {
        checkActive()
        // Pin the original owner's token, even if the SDK's session changes
        // while fetch authorization is being assembled asynchronously.
        const { data, error } = await db.rpc(name, args).setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(deadline.signal)
        checkActive()
        if (error) throw error
        return data
      })
    }
    await synchronize({
      read: () => deadline.step('membaca penyimpanan lokal', () => readWorkspace(scope)), active,
      update: apply => deadline.step('menyimpan hasil lokal', () => commitWorkspace(scope, token, (workspace, backup) => { checkActive(); return apply(workspace, backup) })),
    }, {
      read: async () => {
        if (!active()) throw new Error('Sesi berubah.')
        return decodeSnapshot(await rpc('finance_read'))
      },
      push: async (revision, operationId, state) => {
        if (!active()) throw new Error('Sesi berubah.')
        return await rpc('finance_push', { p_expected_revision: revision, p_operation_id: operationId, p_data: state }) as { revision: number }
      },
    })
    if (!active()) return
    await deadline.step('memuat hasil lokal', () => refreshWorkspace())
    if (!active()) return
    markCloudLoaded(scope, token)
    setSyncStatus({ status: isDirty() ? 'idle' : 'ok', lastSync: getWorkspace()?.lastSync ?? null, error: null })
  }, { onStage: phase => { if (ownerActive()) setSyncStatus({ phase }) } })
  const flight = { generation: token, promise, again: false }
  flights.set(scope, flight)
  let succeeded = false
  try { await promise; succeeded = true }
  catch (error) {
    if (ownerActive()) setSyncStatus({ status: 'error', error: error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'Sync gagal', autoRetryBlocked: (error as { code?: string })?.code === 'SYNC_TIMEOUT' })
    throw error
  }
  finally {
    if (flights.get(scope) === flight) flights.delete(scope)
    if (flight.again && succeeded && ownerActive() && !getWorkspace()?.conflict) void runSync(true).catch(() => {})
  }
}
export function hasPendingPush(_state: State, userId: string): boolean { return getScope() === `user:${userId}` && isDirty() }
export async function resolveSyncConflict(choice: 'local' | 'remote', reviewed?: Pick<Workspace, 'scope' | 'state' | 'base' | 'conflict'> & { generation: number }): Promise<void> {
  const scope = getScope(); const token = getGeneration()
  await commitWorkspace(scope, token, (workspace, backup) => {
    if (reviewed) requireValue(reviewed.scope === scope && reviewed.generation === token && same(dataOf(workspace.state), dataOf(reviewed.state)) && same(workspace.base, reviewed.base) && same(workspace.conflict, reviewed.conflict), 'Data konflik berubah. Periksa perbandingan terbaru sebelum memilih kembali.')
    if (!workspace.conflict) return
    backup('before-resolving-conflict')
    const { remote, revision } = workspace.conflict
    workspace.state = { ...reconcile(workspace.base, dataOf(workspace.state), remote, choice), settings: workspace.state.settings }
    workspace.base = remote; workspace.revision = revision; workspace.pending = null; workspace.conflict = null
  })
  await runSync(true)
}
