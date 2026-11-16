import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { actions, getGeneration, getScope, getWorkspace, useFinance } from '../lib/store'
import { resolveImport, useUI } from '../lib/ui'
import { useLocale, useMessage, useT } from '../lib/i18n'
import { buildMergePlan } from '../lib/mergeImport'
import { stateContentKey } from '../lib/backupPolicy'
import { same } from '../lib/reconcile'
import { entityKeys, totalBalance } from '../lib/model'
import { formatIDR } from '../lib/format'
import type { ImportMode, ImportReview, MergeChoices } from '../lib/mergeTypes'
import { ImportMergeReview } from './ImportMergeReview'

export function ImportDialog() {
  const { importing } = useUI()
  return importing ? <ImportSession key={importing.id} request={importing} /> : null
}
function ImportSession({ request }: { request: NonNullable<ReturnType<typeof useUI>['importing']> }) {
  const currentState = useFinance(); const t = useT(); const locale = useLocale(); const headingId = useId()
  const message = useMessage()
  const [review, setReview] = useState<ImportReview | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [choices, setChoices] = useState<MergeChoices>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null); const alive = useRef(true)
  const loadSequence = useRef(0)
  const matches = request.options.scope === getScope() && request.options.generation === getGeneration()
  const load = async () => {
    const sequence = ++loadSequence.current
    setLoading(true); setError(null)
    try {
      const loaded = await actions.prepareImportReview(request.options.json, request.options.scope, request.options.generation, request.options.source)
      if (alive.current && sequence === loadSequence.current) { setReview(loaded); setChoices({}) }
    } catch (error) { if (alive.current && sequence === loadSequence.current) setError(error instanceof Error ? error.message : t('errorFileInvalid')) }
    finally { if (alive.current && sequence === loadSequence.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    const element = dialog.current; element?.showModal()
    void load()
    return () => { alive.current = false; element?.close() }
  }, [])
  useEffect(() => { if (!matches) resolveImport(false, request.id) }, [matches, request.id])
  const plan = useMemo(() => review ? buildMergePlan(review.workspace, review.imported, choices, review.allocations) : null, [review, choices])
  if (!matches) return null
  const current = getWorkspace()
  const stale = Boolean(review && (stateContentKey(currentState) !== stateContentKey(review.workspace.state) || !same(current?.mergeIds, review.workspace.mergeIds) || !same(current?.importIds, review.workspace.importIds) || current?.guestImport !== review.workspace.guestImport))
  const replace = mode === 'replace'
  const errors = replace ? review?.replaceError ? [review.replaceError] : [] : plan?.errors ?? []
  const blocked = !review || loading || busy || stale || Boolean(current?.conflict) || errors.length > 0 || (!replace && Boolean(plan?.unresolved))
  const result = replace ? review?.replacement?.state : plan?.state
  let balances: { before: number; after: number } | null = null
  if (review && result) {
    try { balances = { before: totalBalance(review.workspace.state.accounts, review.workspace.state.transactions), after: totalBalance(result.accounts, result.transactions) } }
    catch { /* Domain validation above reports unsafe totals and blocks commit. */ }
  }
  const commit = () => {
    if (blocked || !review) return
    setBusy(true); setError(null)
    void actions.commitImportReview(review, mode, choices).then(() => resolveImport(true, request.id)).catch(error => {
      if (alive.current) setError(error instanceof Error ? error.message : t('errorFileInvalid'))
    }).finally(() => { if (alive.current) setBusy(false) })
  }
  const close = () => { if (!busy) resolveImport(false, request.id) }
  return <dialog ref={dialog} aria-labelledby={headingId} className="fixed inset-0 m-auto max-h-[calc(100%_-_2rem)] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-card border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/50" onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
  }}>
    <div className="flex items-center justify-between gap-3">
      <h2 id={headingId} className="text-[16px] font-semibold">{message(request.options.title)}</h2>
      <button disabled={busy} onClick={close} className="text-[13px] text-ink-subtle disabled:opacity-50">{t('cancel')}</button>
    </div>
    {request.options.source === 'guest' ? <p className="mt-4 text-[12px] text-ink-muted">{t('guestImportHint')}</p> : <div className="mt-4 grid grid-cols-2 gap-2 rounded-button bg-canvas p-1">{(['merge', 'replace'] as const).map(value => <button key={value} disabled={busy || loading} aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-[6px] px-2 py-2 text-[13px] font-medium ${mode === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}>{t(value === 'merge' ? 'mergeMode' : 'replaceMode')}</button>)}</div>}
    {loading && <p role="status" className="mt-3 text-[13px] text-ink-muted">{t('importPreparing')}</p>}
    {error && <p role="alert" className="mt-3 text-[12px] text-negative">{message(error)}</p>}
    {(stale || current?.conflict) && <p role="alert" className="mt-3 text-[12px] text-warning">{t(current?.conflict ? 'importConflictBlocked' : 'importStale')}</p>}
    {errors.map((error, index) => <p role="alert" key={index} className="mt-3 text-[12px] text-negative">{message(error)}</p>)}
    {!loading && review && plan && <>
      <p className="mt-3 text-[12px] text-ink-muted">{t(replace ? 'importConfirmHint' : 'mergePreviewHint')}</p>
      {replace && review.purgedRows > 0 && <p className="mt-2 text-[12px] text-warning">{t('restoreImportHint').replace('{n}', String(review.purgedRows))}</p>}
      <div className="my-4 overflow-x-auto rounded-input border border-line">
        <table className="w-full text-left text-[12px]" aria-label={t('importSummary')}>
          <thead className="bg-canvas text-ink-muted"><tr><th className="p-2">{t('data')}</th><th className="p-2">{t('importBefore')}</th><th className="p-2">{t('importAfter')}</th><th className="p-2">{t('importAdded')}</th><th className="p-2">{t('importUpdated')}</th></tr></thead>
          <tbody>{entityKeys.map(key => {
            const rows = result?.[key].filter(row => !row.deletedAt) ?? []
            return <tr key={key} className="border-t border-line"><td className="p-2">{t(key)}</td><td className="p-2">{plan.counts[key].before}</td><td className="p-2">{rows.length}</td><td className="p-2">{replace ? rows.filter(row => !review.workspace.state[key].some(old => old.id === row.id)).length : plan.counts[key].added}</td><td className="p-2">{replace ? rows.filter(row => review.workspace.state[key].some(old => old.id === row.id && !same(old, row))).length : plan.counts[key].updated}</td></tr>
          })}</tbody>
        </table>
      </div>
      {balances && <p role="status" aria-label={t('importBalanceSummary')} className="mb-4 text-[13px] font-medium text-ink">{t('totalBalance')} · {t('importBefore')}: {formatIDR(balances.before, locale)} → {t('importAfter')}: {formatIDR(balances.after, locale)}</p>}
      {!replace && <>
        <p role="status" className={`mb-3 text-[12px] ${plan.unresolved ? 'text-warning' : 'text-ink-muted'}`}>{t('mergePendingCount').replace('{n}', String(plan.unresolved))} · {t('mergeIdenticalCount').replace('{n}', String(plan.transactions.filter(row => row.kind === 'identical').length))} · {t('mergeSkippedCount').replace('{n}', String(plan.transactions.filter(row => row.skipped).length))}</p>
        <ImportMergeReview review={review} plan={plan} choices={choices} onChange={setChoices} disabled={busy || stale} />
      </>}
    </>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button disabled={busy || loading} onClick={() => { void load() }} className="rounded-button border border-line px-3 py-2 text-[13px] text-ink-muted disabled:opacity-50">{t('importRefreshPreview')}</button>
      <button disabled={blocked} onClick={commit} className={`rounded-button px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50 ${replace ? 'bg-negative' : 'bg-accent'}`}>{t(replace && review?.purgedRows ? 'restoreImport' : 'importData')}</button>
    </div>
  </dialog>
}
