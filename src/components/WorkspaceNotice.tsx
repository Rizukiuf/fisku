import { useState } from 'react'
import { useSession } from '../hooks/useSession'
import { useGuestImport } from '../hooks/useGuestImport'
import { useSync } from '../hooks/useSync'
import { cloudConfigured } from '../lib/supabase'
import { getGeneration, getScope, getWorkspace, isDirty, useCloudLoaded, useFinance } from '../lib/store'
import { useT } from '../lib/i18n'
import { confirmGuestImport } from '../lib/importConfirm'
import { perform, toast } from '../lib/ui'

export function WorkspaceNotice({ onReviewSync }: { onReviewSync: () => void }) {
  const auth = useSession(); useFinance(); const loaded = useCloudLoaded()
  const sync = useSync(); const t = useT(); const workspace = getWorkspace()
  const enabled = cloudConfigured && !auth.loading && !auth.recovery && Boolean(auth.session) && getScope() === `user:${auth.session?.userId}`
  const guest = useGuestImport(enabled && (loaded || Boolean(workspace?.lastSync)))
  const [deferred, setDeferred] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  if (!enabled) return null
  const dirty = isDirty(); const conflict = workspace?.conflict
  const offline = sync.status === 'offline' || !navigator.onLine
  const failed = sync.status === 'error' || Boolean(sync.error) && sync.status !== 'syncing'
  const key = `${getScope()}:${getGeneration()}:${guest.fingerprint}`
  const kind = conflict ? 'conflict' : offline && dirty ? 'offline' : failed ? 'error' : guest.error ? 'guest-error' : guest.available && key !== deferred ? 'guest' : null
  if (!kind) return null
  const message = kind === 'conflict' ? `${t('noticeConflict')} ${t('noticeConflictCount').replace('{n}', String(conflict!.ids.length))}`
    : kind === 'offline' ? t(sync.autoRetryBlocked ? 'noticeOfflinePaused' : 'noticeOffline') : kind === 'error' ? `${t(dirty ? 'noticeSyncPendingError' : 'noticeSyncReadError')}${sync.autoRetryBlocked ? ` ${t('syncAutoPausedAfterTimeout')}` : ''}`
    : kind === 'guest-error' ? t('noticeGuestReadError') : t('noticeGuest')
  const buttonClass = 'rounded-button border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink disabled:opacity-50'
  return <section aria-label={t('noticeRegion')} className={`mx-5 mt-4 rounded-card border bg-surface p-3 lg:mx-8 ${kind === 'error' ? 'border-negative/40' : 'border-warning/40'}`}>
    <p role={kind === 'guest' ? 'status' : 'alert'} className="text-[12px] leading-relaxed text-ink-muted">{message}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {kind === 'guest' ? <>
        <button disabled={reviewing} className={buttonClass} onClick={() => {
          if (reviewing) return
          setReviewing(true)
          void perform(async () => { if (await confirmGuestImport(t)) toast(t('toastImported'), 'success') }).finally(() => setReviewing(false))
        }}>{t('noticeReviewGuest')}</button>
        <button disabled={reviewing} className={buttonClass} onClick={() => setDeferred(key)}>{t('noticeLater')}</button>
      </> : <>
        {kind === 'error' && <button className={buttonClass} disabled={sync.status === 'syncing'} onClick={() => { void sync.sync() }}>{t('noticeRetry')}</button>}
        <button className={buttonClass} onClick={onReviewSync}>{t(kind === 'conflict' ? 'noticeReviewConflict' : 'noticeSyncDetails')}</button>
      </>}
    </div>
  </section>
}
