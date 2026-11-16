import { useMemo } from 'react'
import { Trash2, Pencil } from 'lucide-react'
import { useFinance, actions, type Transaction } from '../lib/store'
import { formatIDR, formatDate } from '../lib/format'
import { useLocale, useT } from '../lib/i18n'
import { confirmDialog, toast, perform } from '../lib/ui'

export function TransactionList({ items, onEdit }: { items: Transaction[]; onEdit?: (id: string) => void }) {
  const s = useFinance()
  const t = useT()
  const locale = useLocale()

  const catMap = useMemo(() => new Map(s.categories.map(c => [c.id, c.name])), [s.categories])
  const accMap = useMemo(() => new Map(s.accounts.map(a => [a.id, a.name])), [s.accounts])

  const catName = (id?: string) => id ? (catMap.get(id) ?? '—') : '—'
  const accName = (id?: string) => id ? (accMap.get(id) ?? '—') : '—'

  const del = async (id: string) => {
    const ok = await confirmDialog({
      title: t('deleteTransactionConfirm'),
      tone: 'danger',
      confirmLabel: t('delete'),
    })
    if (!ok) return
    await perform(async () => { await actions.deleteTransaction(id); toast(t('toastDeleted'), 'success') })
  }

  return (
    <ul className="divide-y divide-line">
      {items.map((tx) => {
        const isIncome = tx.type === 'income'
        const isTransfer = tx.type === 'transfer'

        const title = isTransfer ? t('transfer') : catName(tx.categoryId)
        const subtitle = isTransfer
          ? `${accName(tx.accountId)} → ${accName(tx.targetAccountId)}`
          : `${accName(tx.accountId)} · ${formatDate(tx.date, locale)}${tx.note ? ` · ${tx.note}` : ''}`

        return (
          <li key={tx.id} className="group flex items-center gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-ink">{title}</p>
              <p className="truncate text-[12px] text-ink-subtle">
                {subtitle}
                {isTransfer && ` · ${formatDate(tx.date, locale)}${tx.note ? ` · ${tx.note}` : ''}`}
              </p>
            </div>
            <p className={`tnum whitespace-nowrap text-[14px] font-semibold ${isIncome ? 'text-positive' : isTransfer ? 'text-ink-muted' : 'text-ink'}`}>
              {isIncome ? '+' : isTransfer ? '⇄' : '−'}{formatIDR(tx.amount, locale)}
            </p>
            <div className="flex items-center gap-1 opacity-60 transition group-hover:opacity-100">
              {onEdit && (
                <button
                  onClick={() => onEdit(tx.id)}
                  aria-label={t('edit')}
                  className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-ink"
                >
                  <Pencil size={14} strokeWidth={1.75} />
                </button>
              )}
              <button
                onClick={() => del(tx.id)}
                aria-label={t('delete')}
                className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-negative"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
