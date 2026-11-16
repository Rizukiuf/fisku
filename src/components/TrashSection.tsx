import { useMemo, useState } from 'react'
import { Trash2, RotateCcw } from 'lucide-react'
import { actions, getGeneration, getScope, useFinance, type Transaction, type Budget } from '../lib/store'
import { formatIDR, formatDate } from '../lib/format'
import { useLocale, useT, type Key } from '../lib/i18n'
import type { RestoreAllResult } from '../lib/restore'
import { confirmDialog, toast, perform } from '../lib/ui'

type TrashKind = 'account' | 'category' | 'transaction' | 'budget'

type TrashItem = {
  kind: TrashKind
  id: string
  name: string
  detail: string
  deletedAt: string
}

export function TrashSection() {
  const s = useFinance()
  const t = useT()
  const locale = useLocale()
  const [restoring, setRestoring] = useState(false)
  const [report, setReport] = useState<RestoreAllResult | null>(null)
  const reasonLabels: Record<keyof RestoreAllResult['skipped'], Key> = { account_missing: 'restoreAllAccountMissing', category_missing: 'restoreAllCategoryMissing', target_account_missing: 'restoreAllTargetMissing', invalid_limit: 'restoreAllInvalidLimit', name_conflict: 'restoreAllNameConflict' }

  const allAccMap = useMemo(() => new Map(s.accounts.map(a => [a.id, a.name])), [s.accounts])
  const allCatMap = useMemo(() => new Map(s.categories.map(c => [c.id, c.name])), [s.categories])

  const resolveTxName = (tx: Transaction): string => {
    if (tx.type === 'transfer') {
      const from = allAccMap.get(tx.accountId) ?? '—'
      const to = allAccMap.get(tx.targetAccountId ?? '') ?? '—'
      return `${from} → ${to}`
    }
    return allCatMap.get(tx.categoryId ?? '') ?? '—'
  }

  const resolveBudgetName = (b: Budget): string => allCatMap.get(b.categoryId) ?? '—'

  const items: TrashItem[] = useMemo(() => {
    const arr: TrashItem[] = []

    for (const a of s.accounts) {
      if (!a.deletedAt) continue
      arr.push({
        kind: 'account', id: a.id, name: a.name,
        detail: t('trashTypeAccount'), deletedAt: a.deletedAt,
      })
    }
    for (const c of s.categories) {
      if (!c.deletedAt) continue
      arr.push({
        kind: 'category', id: c.id, name: c.name,
        detail: `${t('trashTypeCategory')} · ${c.type === 'income' ? t('incomeShort') : t('expense')}`,
        deletedAt: c.deletedAt,
      })
    }
    for (const tx of s.transactions) {
      if (!tx.deletedAt) continue
      const sign = tx.type === 'income' ? '+' : tx.type === 'transfer' ? '⇄' : '−'
      arr.push({
        kind: 'transaction', id: tx.id, name: resolveTxName(tx),
        detail: `${t('trashTypeTransaction')} · ${sign}${formatIDR(tx.amount, locale)}`,
        deletedAt: tx.deletedAt,
      })
    }
    for (const b of s.budgets) {
      if (!b.deletedAt) continue
      arr.push({
        kind: 'budget', id: b.id, name: resolveBudgetName(b),
        detail: `${t('trashTypeBudget')} · ${formatIDR(b.limit, locale)}`,
        deletedAt: b.deletedAt,
      })
    }

    return arr.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }, [s, locale, t])

  const total = items.length
  const restoredCount = report ? Object.values(report.restored).reduce((sum, value) => sum + value, 0) : 0
  const skippedCount = report ? Object.values(report.skipped).reduce((sum, value) => sum + value, 0) : 0
  const handleRestoreAll = () => {
    if (restoring) return
    const expectedScope = getScope(); const expectedGeneration = getGeneration(); const expectedState = s
    setRestoring(true); setReport(null)
    void perform(async () => {
      if (!await confirmDialog({ title: t('restoreAllConfirm'), description: t('restoreAllHint'), confirmLabel: t('restoreAll') })) return
      const result = await actions.restoreAll({ expectedScope, expectedGeneration, expectedState })
      setReport(result)
      if (result.changed) toast(t('toastRestored'), 'success')
    }).finally(() => setRestoring(false))
  }

  const handleRestore = (item: TrashItem) => {
    void perform(async () => {
    let result
    if (item.kind === 'transaction') result = await actions.restoreTransaction(item.id)
    else if (item.kind === 'account') result = await actions.restoreAccount(item.id)
    else if (item.kind === 'category') result = await actions.restoreCategory(item.id)
    else result = await actions.restoreBudget(item.id)

    if (!result.ok) {
      const reasonMap: Record<string, string> = {
        account_missing: t('parentAccount'),
        category_missing: t('parentCategory'),
        target_account_missing: t('parentTargetAccount'),
      }
      const parent = reasonMap[result.reason ?? ''] ?? '?'
      toast(t('toastRestoreFailedParent').replace('{parent}', parent), 'error')
      return
    }
    toast(t('toastRestored'), 'success')
    })
  }

  const handlePurge = async (item: TrashItem) => {
    const ok = await confirmDialog({
      title: t('deleteForeverConfirm'),
      description: t('deleteForeverHint'),
      tone: 'danger',
      confirmLabel: t('deleteForever'),
    })
    if (!ok) return

    await perform(async () => {
    const purged = await actions.purgeOne(item.kind, item.id)
    if (!purged) {
      toast(t('toastPurgeNone'), 'error')
      return
    }

    toast(t('toastPurgedItem'), 'success')
    })
  }

  return (
    <details className="group mt-4 overflow-hidden rounded-card border border-line bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium text-ink-muted hover:text-ink select-none">
        <span className="inline-flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="transition-transform group-open:rotate-90">
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {t('trash')}
          {total > 0 && (
            <span className="rounded-pill bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
              {t('trashCount').replace('{n}', String(total))}
            </span>
          )}
        </span>
      </summary>

      <div className="border-t border-line">
        <p className="px-4 pt-3 pb-2 text-[11px] text-ink-subtle">{t('trashHint')}</p>
        {total > 0 && <div className="px-4 pb-3"><button disabled={restoring} onClick={handleRestoreAll} className="inline-flex items-center gap-1.5 rounded-button border border-line px-3 py-2 text-[12px] font-medium text-ink-muted hover:text-positive disabled:opacity-50"><RotateCcw size={13} />{t('restoreAll')}</button></div>}
        {report && <div className="px-4 pb-3 text-[12px] text-ink-muted">
          <p role="status">{t(restoredCount === 1 ? 'restoreAllSummaryOne' : 'restoreAllSummary').replace('{n}', String(restoredCount))}</p>
          {skippedCount > 0 && <><p className="mt-1 text-warning">{t(skippedCount === 1 ? 'restoreAllSkippedOne' : 'restoreAllSkipped').replace('{n}', String(skippedCount))}</p><ul className="mt-1 space-y-1 text-[11px] text-ink-subtle">{(Object.keys(report.skipped) as (keyof RestoreAllResult['skipped'])[]).filter(reason => report.skipped[reason] > 0).map(reason => <li key={reason}>{t(reasonLabels[reason]).replace('{n}', String(report.skipped[reason]))}</li>)}</ul></>}
        </div>}

        {total === 0 ? (
          <p className="px-4 pb-4 text-center text-[12px] text-ink-subtle">{t('trashEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{item.name}</p>
                  <p className="truncate text-[11px] text-ink-subtle">
                    {item.detail} · {t('deletedOn')} {formatDate(item.deletedAt, locale)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    disabled={restoring}
                    onClick={() => handleRestore(item)}
                    aria-label={t('restore')}
                    title={t('restore')}
                    className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-positive"
                  >
                    <RotateCcw size={13} strokeWidth={1.75} />
                  </button>
                  <button
                    disabled={restoring}
                    onClick={() => handlePurge(item)}
                    aria-label={t('deleteForever')}
                    title={t('deleteForever')}
                    className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-negative"
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
