import { getScope, isReady } from '../lib/store'
import { openDatabase } from '../lib/repository'
import { downloadJSON } from '../lib/download'
import { useEffect } from 'react'
import { useMessage, useT } from '../lib/i18n'
import { browserLanguage } from '../lib/messages'
export function StartupPanel({ error }: { error?: string | null }) {
  const fallback = isReady() ? undefined : browserLanguage()
  const t = useT(fallback); const message = useMessage(fallback)
  useEffect(() => { if (fallback) document.documentElement.lang = fallback }, [fallback])
  async function exportRecovery() {
    const result: Record<string, unknown> = { scope: getScope() }
    try {
      const db = await openDatabase()
      result.workspace = await new Promise((resolve, reject) => {
        const tx = db.transaction('workspaces', 'readonly'); const request = tx.objectStore('workspaces').get(getScope())
        tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error)
      })
    } catch { result.storageUnavailable = true }
    for (const key of ['finance.v3', 'finance.v2']) { try { result[key] = localStorage.getItem(key) } catch { result.localStorageUnavailable = true } }
    downloadJSON(result, 'fisku-recovery-raw.json')
  }
  return <div className="flex min-h-dvh items-center justify-center bg-canvas p-5 text-ink"><section className="w-full max-w-md rounded-card border border-line bg-surface p-5">
    <h1 className="text-[16px] font-semibold">Fisku</h1>
    <p role={error ? 'alert' : 'status'} className="mt-3 text-[13px] text-ink-muted">{error ? message(error) : t('loadingStoredData')}</p>
    {error && <div className="mt-4 flex gap-2">
      <button onClick={() => window.location.reload()} className="rounded-button bg-accent px-3 py-2 text-[13px] text-white">{t('retry')}</button>
      <button onClick={() => { void exportRecovery() }} className="rounded-button border border-line px-3 py-2 text-[13px]">{t('exportRecovery')}</button>
    </div>}
  </section></div>
}
