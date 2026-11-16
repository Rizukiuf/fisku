import { useCallback } from 'react'
import { useSyncStatus } from '../lib/syncStatus'
import { runSync } from '../lib/sync'

export function useSync() {
  const { status, lastSync, error, autoRetryBlocked } = useSyncStatus()
  const sync = useCallback(async () => { try { await runSync(false) } catch {} }, [])
  const forceFullSync = useCallback(async () => { try { await runSync(true) } catch {} }, [])
  return { status, lastSync, error, autoRetryBlocked, sync, forceFullSync }
}
