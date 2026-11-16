import { dataOf, decodeState, defaults, requireValue, uid, type Data } from './model'
import { DataConflict, reconcile, same } from './reconcile'
import type { Workspace } from './repository'

export type RemoteSnapshot = { revision: number; state: Data }
export type Transport = { read(): Promise<RemoteSnapshot>; push(revision: number, operationId: string, data: Data): Promise<{ revision: number }> }
export type LocalSync = {
  read(): Promise<Workspace>
  update<T>(apply: (workspace: Workspace, backup: (reason: string, state?: Workspace['state']) => void) => T): Promise<T>
  active(): boolean
}
export function decodeSnapshot(input: unknown): RemoteSnapshot {
  const value = input as RemoteSnapshot
  requireValue(value && Number.isSafeInteger(value.revision) && value.revision >= 0, 'Versi database cloud tidak valid.')
  return { revision: value.revision, state: dataOf(decodeState({ ...value.state, settings: defaults })) }
}
function checkActive(local: LocalSync) { requireValue(local.active(), 'Sesi berubah; hasil sinkronisasi tidak diterapkan.') }
export async function synchronize(local: LocalSync, transport: Transport): Promise<void> {
  // A pending request is durable before any network write. Retry it before pulling:
  // a lost response must not be mistaken for a concurrent edit from another device.
  for (let attempt = 0; attempt < 8; attempt++) {
    checkActive(local)
    let current = await local.read()
    if (current.pending) {
      const pending = current.pending
      let acknowledgement: { revision: number }
      try { acknowledgement = await transport.push(pending.revision, pending.id, pending.data) }
      catch (error) {
        // Only an explicit CAS rejection permits discarding the request ID.
        // Network failures leave it intact for an idempotent retry.
        const code = (error as { code?: string })?.code
        if (code !== 'PT409' && code !== '40001') throw error
        checkActive(local)
        await local.update(workspace => { if (workspace.pending?.id === pending.id) workspace.pending = null })
        continue
      }
      checkActive(local)
      requireValue(Number.isSafeInteger(acknowledgement.revision) && acknowledgement.revision > pending.revision, 'Pengakuan versi cloud tidak valid.')
      await local.update(workspace => {
        if (workspace.pending?.id !== pending.id) return
        // A new local edit made during the request remains in workspace.state.
        workspace.base = pending.data; workspace.revision = acknowledgement.revision; workspace.pending = null
      })
    }
    const remote = decodeSnapshot(await transport.read())
    checkActive(local)
    const outcome = await local.update((workspace, backup) => {
      // Another tab may have changed the base while this read was in flight.
      if (workspace.pending || remote.revision < workspace.revision) return 'retry' as const
      let merged: Data
      try { merged = reconcile(workspace.base, dataOf(workspace.state), remote.state) }
      catch (error) {
        if (!(error instanceof DataConflict)) throw error
        if (!workspace.conflict || workspace.conflict.revision !== remote.revision) {
          backup('sync-conflict-local')
          backup('sync-conflict-cloud', { ...remote.state, settings: workspace.state.settings })
        }
        workspace.conflict = { remote: remote.state, revision: remote.revision, ids: error.ids }
        return 'conflict' as const
      }
      workspace.state = { ...merged, settings: workspace.state.settings }
      workspace.base = remote.state; workspace.revision = remote.revision; workspace.conflict = null
      if (!same(merged, remote.state)) {
        workspace.pending = { id: uid(), revision: remote.revision, data: merged }
        return 'retry' as const
      }
      workspace.lastSync = new Date().toISOString()
      return 'done' as const
    })
    if (outcome === 'conflict') { current = await local.read(); throw new DataConflict(current.conflict?.ids ?? ['data']) }
    if (outcome === 'done') return
  }
  throw new Error('Data masih berubah di perangkat lain. Perubahan lokal tetap tersimpan; sinkronisasi akan dicoba lagi.')
}
