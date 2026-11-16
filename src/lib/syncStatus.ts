import { useSyncExternalStore } from 'react'

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error' | 'offline'

type Snapshot = {
  status: SyncStatus
  lastSync: string | null
  error: string | null
  phase: string | null
  startedAt: number | null
  autoRetryBlocked: boolean
}

let snapshot: Snapshot = {
  status: 'idle',
  lastSync: null,
  error: null,
  phase: null,
  startedAt: null,
  autoRetryBlocked: false,
}

const listeners = new Set<() => void>()

export function setSyncStatus(patch: Partial<Snapshot>) {
  const starting = patch.status === 'syncing' && snapshot.status !== 'syncing'
  snapshot = { ...snapshot, ...patch }
  if (starting) snapshot = { ...snapshot, phase: null, startedAt: performance.now(), autoRetryBlocked: false }
  if (patch.status && patch.status !== 'syncing') snapshot = { ...snapshot, phase: null, startedAt: null }
  if (patch.status === 'ok') snapshot = { ...snapshot, autoRetryBlocked: false }
  listeners.forEach((l) => l())
}

export const getSyncStatus = () => snapshot

export function useSyncStatus(): Snapshot {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => snapshot,
  )
}
