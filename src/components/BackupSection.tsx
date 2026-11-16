import { useEffect, useState } from 'react'
import { actions, getGeneration, getScope, useFinance } from '../lib/store'
import { listBackups, type BackupView } from '../lib/repository'
import { useLocale, useT } from '../lib/i18n'
import { confirmDialog, perform, toast } from '../lib/ui'
import { downloadJSON } from '../lib/download'

export function BackupSection() {
  const state = useFinance(); const t = useT()
  const locale = useLocale()
  const [backups, setBackups] = useState<BackupView[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void perform(async () => { const saved = await listBackups(getScope()); if (active) setBackups(saved) })
    return () => { active = false }
  }, [state])
  const remove = async (id?: string) => {
    if (busy) return
    const scope = getScope(); const token = getGeneration()
    setBusy(true)
    try {
      const confirmed = await confirmDialog({ title: t(id ? 'deleteBackupConfirm' : 'deleteBackupsConfirm'), description: t('deleteBackupHint'), tone: 'danger', confirmLabel: t(id ? 'deleteBackup' : 'deleteAllBackups') })
      if (!confirmed) return
      await perform(async () => {
        const count = id ? Number(await actions.deleteBackup(id, scope, token)) : await actions.deleteBackups(scope, token)
        toast(t(count ? 'toastBackupDeleted' : 'toastNoBackups'), count ? 'success' : 'default')
      })
    } finally { setBusy(false) }
  }
  if (!backups.length) return null
  return <details className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
    <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink-muted">{t('automaticBackups')}</summary>
    <div className="border-t border-line p-3">
      <p className="mb-2 text-[11px] text-ink-subtle">{t('backupHint')}</p>
      {backups.some(backup => backup.protected) && <p className="mb-2 text-[11px] text-warning">{t('backupProtectionHint')}</p>}
      <ul className="space-y-2">{backups.map(backup => <li key={backup.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-muted">
        <span>{new Date(backup.at).toLocaleString(locale)} · {t(backup.reason.includes('cloud') ? 'backupCloud' : backup.reason.includes('local') ? 'backupLocal' : 'backupBeforeChange')}{backup.protected ? ` · ${t('backupProtected')}` : ''}</span>
        <div className="flex gap-2">
          <button className="rounded-button border border-line px-2.5 py-1.5" onClick={() => downloadJSON({ format: 'fisku-backup', version: 1, exportedAt: backup.at, data: backup.state }, `fisku-recovery-${backup.id}.json`)}>{t('exportData')}</button>
          <button disabled={busy || backup.protected} className="rounded-button border border-negative/40 px-2.5 py-1.5 text-negative disabled:opacity-50" onClick={() => { void remove(backup.id) }}>{t('deleteBackup')}</button>
        </div>
      </li>)}</ul>
      <button disabled={busy || backups.every(backup => backup.protected)} className="mt-3 rounded-button border border-negative/40 px-3 py-2 text-[12px] text-negative disabled:opacity-50" onClick={() => { void remove() }}>{t('deleteAllBackups')}</button>
    </div>
  </details>
}
