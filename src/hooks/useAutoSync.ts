import { useEffect } from 'react'
import { useSession } from './useSession'
import { getScope, getWorkspace, isDirty, subscribeStore } from '../lib/store'
import { runSync } from '../lib/sync'
import { getSyncStatus, setSyncStatus } from '../lib/syncStatus'
import { cloudConfigured } from '../lib/supabase'

export function useAutoSync() {
  const { session, loading } = useSession()
  const userId = session?.userId ?? null
  useEffect(() => {
    if (!cloudConfigured || loading || !userId) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const run = async () => {
      if (!active || getScope() !== `user:${userId}` || getSyncStatus().autoRetryBlocked) return
      try { await runSync(); failures = 0 }
      catch (error) {
        if (!active || getWorkspace()?.conflict) return
        const code = (error as { code?: string })?.code ?? ''
        if (code === 'SYNC_TIMEOUT') { clearTimeout(timer); return }
        const httpStatus = (error as { status?: number })?.status
        if (/^(22|23|42|PGRST)/.test(code) || httpStatus === 400 || httpStatus === 401 || httpStatus === 403) return
        failures++
        clearTimeout(timer)
        timer = setTimeout(() => { void run() }, Math.min(60000, 2000 * 2 ** Math.min(failures, 5)) + Math.random() * 1000)
      }
    }
    const unsub = subscribeStore(() => {
      if (getWorkspace()?.conflict || getScope() !== `user:${userId}` || getSyncStatus().autoRetryBlocked) return
      if (isDirty()) {
        if (getSyncStatus().status !== 'syncing') setSyncStatus({ status: 'idle', lastSync: getWorkspace()?.lastSync ?? null })
        clearTimeout(timer); timer = setTimeout(() => { void run() }, 2000)
      }
    })
    const onOnline = () => {
      if (!active || getScope() !== `user:${userId}`) return
      if (getSyncStatus().autoRetryBlocked) { setSyncStatus({ status: 'error' }); return }
      void run()
    }
    const onOffline = () => { if (active && getScope() === `user:${userId}`) setSyncStatus({ status: 'offline' }) }
    let lastFocus = 0
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastFocus < 5000 || getWorkspace()?.conflict) return
      lastFocus = Date.now(); void run()
    }
    const interval = setInterval(() => { if (!getWorkspace()?.conflict) void run() }, 60000)
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus)
    void run()
    return () => {
      active = false; clearTimeout(timer); clearInterval(interval); unsub()
      window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus)
    }
  }, [userId, loading])
}
