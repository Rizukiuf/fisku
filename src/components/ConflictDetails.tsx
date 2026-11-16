import { useMemo, useState } from 'react'
import { buildConflictDetails, type ConflictField, type ConflictValue } from '../lib/conflictDetails'
import { formatDate, formatIDR } from '../lib/format'
import { useAccountTypeLabel, useLocale, useMessage, useT, type Key } from '../lib/i18n'
import type { Workspace } from '../lib/repository'

const fieldLabels: Record<ConflictField, Key> = { name: 'conflictName', type: 'conflictType', initialBalance: 'startingBalance', amount: 'amount', date: 'date', note: 'note', accountId: 'account', categoryId: 'category', targetAccountId: 'toAccount', limit: 'budgetLimit', deletedAt: 'deletedOn', status: 'conflictState' }
const kindLabels = { accounts: 'trashTypeAccount', categories: 'trashTypeCategory', transactions: 'trashTypeTransaction', budgets: 'trashTypeBudget' } as const
const stateLabels = { active: 'conflictActive', deleted: 'conflictDeleted', purged: 'conflictPurged', missing: 'conflictMissing' } as const
const PAGE_SIZE = 20

export function ConflictDetails({ workspace }: { workspace: Workspace }) {
  const t = useT(); const locale = useLocale(); const accountType = useAccountTypeLabel()
  const message = useMessage()
  const [page, setPage] = useState(0)
  const conflict = workspace.conflict!
  const comparison = useMemo(() => buildConflictDetails(workspace.state, conflict.remote, conflict.ids, workspace.base), [workspace.base, workspace.state, conflict])
  const pages = Math.max(1, Math.ceil(comparison.items.length / PAGE_SIZE)); const current = Math.min(page, pages - 1)
  const display = ({ kind, value }: ConflictValue): string => {
    if (value === null || value === '') return '—'
    if (kind === 'money') return formatIDR(Number(value), locale)
    if (kind === 'date') return formatDate(String(value), locale)
    if (kind === 'time') return new Date(value).toLocaleString(locale)
    if (kind === 'accountType') return accountType(String(value))
    if (kind === 'txType') return t(value === 'income' ? 'incomeShort' : value === 'expense' ? 'expense' : 'transfer')
    if (kind === 'status') return t(stateLabels[value as keyof typeof stateLabels])
    return String(value)
  }
  return <section aria-label={t('conflictDetails')} className="min-w-0 space-y-3">
    <p className="text-[11px] text-ink-subtle">{comparison.items.length} {t('conflictItems')}</p>
    <p className="text-[11px] leading-relaxed text-ink-subtle">{t('conflictVersionsHint')}</p>
    {comparison.wholeDataset && <p className="text-[12px] text-warning">{t('conflictRelationsHint')}</p>}
    {comparison.items.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(item => <article key={item.key} className="min-w-0 border-t border-line pt-3">
      <h3 className="mb-2 break-words text-[12px] font-semibold text-ink">{t(kindLabels[item.kind])} · {item.name}</h3>
      {item.fields.length ? <table className="w-full table-fixed text-left text-[11px]">
        <thead className="text-ink-subtle"><tr><th className="w-1/4 py-1 font-medium">{t('conflictField')}</th><th className="px-2 py-1 font-medium">{t('backupLocal')}</th><th className="px-2 py-1 font-medium">{t('backupCloud')}</th></tr></thead>
        <tbody>{item.fields.map(field => <tr key={field.field} className="border-t border-line align-top text-ink-muted">
          <th scope="row" className="break-words py-2 pr-1 font-normal">{t(fieldLabels[field.field])}</th>
          <td className="px-2 py-2"><div className="max-h-40 overflow-y-auto break-words whitespace-pre-wrap">{display(field.local)}</div></td><td className="px-2 py-2"><div className="max-h-40 overflow-y-auto break-words whitespace-pre-wrap">{display(field.remote)}</div></td>
        </tr>)}</tbody>
      </table> : <p className="text-[11px] text-ink-subtle">{t('conflictNowSame')}</p>}
    </article>)}
    {pages > 1 && <div className="flex items-center justify-between gap-2 text-[12px] text-ink-muted">
      <button disabled={current === 0} className="rounded-button border border-line px-2 py-1 disabled:opacity-50" onClick={() => setPage(current - 1)}>{t('mergePreviousPage')}</button>
      <span>{current + 1} / {pages}</span>
      <button disabled={current + 1 === pages} className="rounded-button border border-line px-2 py-1 disabled:opacity-50" onClick={() => setPage(current + 1)}>{t('mergeNextPage')}</button>
    </div>}
    <details className="text-[11px] text-ink-subtle"><summary className="cursor-pointer">{t('conflictTechnical')}</summary><ul className="mt-2 space-y-1">{comparison.ids.map(id => <li key={id} className="break-all">{message(id)}</li>)}</ul></details>
  </section>
}
