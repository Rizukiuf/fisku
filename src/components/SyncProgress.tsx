import { useEffect, useState } from 'react'
import { useSyncStatus } from '../lib/syncStatus'
import { useMessage, useT } from '../lib/i18n'

export function SyncProgress() {
  const { status, phase, startedAt } = useSyncStatus(); const t = useT()
  const message = useMessage()
  const [, tick] = useState(0)
  useEffect(() => {
    if (status !== 'syncing') return
    const timer = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [status, startedAt])
  if (status !== 'syncing') return null
  const seconds = startedAt === null ? 0 : Math.max(0, Math.floor((performance.now() - startedAt) / 1000))
  return <p role="status" className="text-[11px] text-ink-subtle">{t('syncStage')}: {message(phase ?? t('syncStarting'))} · {seconds} {t('syncSeconds')}</p>
}
