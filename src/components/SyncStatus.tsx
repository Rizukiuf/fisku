import { Cloud, CloudOff, RefreshCw, Check } from 'lucide-react'
import { useSyncStatus } from '../lib/syncStatus'
import { cloudConfigured } from '../lib/supabase'
import { getScope, getWorkspace, isDirty, useFinance } from '../lib/store'
import { useMessage, useT } from '../lib/i18n'

export function SyncStatus({ variant = 'pill' }: { variant?: 'pill' | 'inline' }) {
  const { status, lastSync, error } = useSyncStatus()
  useFinance()
  const t = useT()
  const message = useMessage()
  if (!cloudConfigured) return null
  const conflict = Boolean(getWorkspace()?.conflict)
  const failed = status === 'error' || Boolean(error) && status !== 'syncing'
  const pending = getScope().startsWith('user:') && isDirty()

  const label =
    conflict            ? t('noticeConflictLabel') :
    status === 'syncing' ? t('syncing') :
    failed              ? t('syncFailed') :
    status === 'offline' ? t('offline') :
    !getScope().startsWith('user:') ? t('savedLocally') :
    pending             ? t('pendingSync') :
    lastSync             ? t('synced') : t('notSynced')

  const tone =
    conflict            ? 'text-warning' :
    status === 'syncing' ? 'text-ink-muted' :
    failed              ? 'text-negative' :
    status === 'offline' ? 'text-warning' :
    pending             ? 'text-ink-muted' : 'text-positive'

  const Icon =
    conflict            ? CloudOff :
    status === 'syncing' ? RefreshCw :
    status === 'offline' ? CloudOff :
    failed              ? CloudOff :
    status === 'ok'      ? Check :
                           Cloud

  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${tone}`} title={message(error ?? label)}>
        <Icon size={12} strokeWidth={2} className={status === 'syncing' ? 'animate-spin' : ''} />
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div
      className={`fixed right-3 top-3 z-30 flex items-center gap-1.5 rounded-pill border border-line bg-surface/90 px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur ${tone} lg:hidden`}
      title={message(error ?? label)}
    >
      <Icon size={12} strokeWidth={2} className={status === 'syncing' ? 'animate-spin' : ''} />
      <span>{label}</span>
    </div>
  )
}
