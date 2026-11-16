import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { actions, budgetsForMonth, useFinance, getState, type Budget } from '../lib/store'
import { formatIDR, formatNumber, parseAmount } from '../lib/format'
import { handleAmountChange } from '../lib/amountInput'
import { useLocale, useT } from '../lib/i18n'
import { confirmDialog, toast, perform } from '../lib/ui'
import { BudgetForm } from '../components/BudgetForm'

export function Budgets() {
  const s = useFinance()
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const rows = budgetsForMonth(s)
  const totalLimit = rows.reduce((a, b) => a + b.limit, 0)
  const totalSpent = rows.reduce((a, b) => a + b.spent, 0)
  const pct = totalLimit > 0 ? Math.min((totalSpent / totalLimit) * 100, 100) : 0

  return (
    <div className="px-5 lg:px-8 pt-8 lg:pt-6 pb-28 lg:pb-12">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-bold text-ink">{t('budgets')}</h1>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-button bg-accent px-3 py-2 text-[13px] font-semibold text-white"
        >
          <Plus size={14} strokeWidth={2.5} /> {t('addBudget')}
        </button>
      </div>

      <div className="mt-4 rounded-card border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium text-ink-muted">{t('budgetThisMonth')}</p>
          <p className="tnum text-[13px] font-semibold text-ink">
            {formatIDR(totalSpent, locale)}{' '}
            <span className="font-normal text-ink-subtle">
              / {totalLimit > 0 ? formatIDR(totalLimit, locale) : '—'}
            </span>
          </p>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-pill bg-budget-soft">
          <div className="h-full rounded-pill bg-budget transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <p className="mt-3 text-[11px] text-ink-subtle">{t('manageInSettings')}</p>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] text-ink-muted">{t('noBudgetsYet')}</p>
          <button onClick={() => setOpen(true)} className="mt-2 text-[13px] font-medium text-accent">
            {t('addFirstBudget')}
          </button>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
          {rows.map(({ category, limit, spent }) => (
            <BudgetRow key={category.id} categoryId={category.id} name={category.name} limit={limit} spent={spent} />
          ))}
        </ul>
      )}

      <BudgetForm open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function BudgetRow({ categoryId, name, limit, spent }: { categoryId: string; name: string; limit: number; spent: number }) {
  const t = useT()
  const locale = useLocale()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [original, setOriginal] = useState<Budget | null>(null)

  const over = limit > 0 && spent > limit
  const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0

  const startEdit = () => {
    setOriginal(getState().budgets.find(row => row.categoryId === categoryId) ?? null)
    setDraft(limit ? formatNumber(limit).replace(/,/g, '.') : '')
    setEditing(true)
  }
  const save = () => {
    void perform(async () => {
    const next = parseAmount(draft)
    await actions.setBudget(categoryId, next, original)
    if (next > 0) toast(t('toastBudgetUpdated'), 'success')
    setEditing(false)
    })
  }
  const remove = async () => {
    const ok = await confirmDialog({
      title: t('deleteBudgetConfirm'),
      description: t('deleteBudgetHint'),
      tone: 'danger',
      confirmLabel: t('delete'),
    })
    if (!ok) return
    await perform(async () => { await actions.removeBudget(categoryId); toast(t('toastBudgetRemoved'), 'success') })
  }

  return (
    <li className="group px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[14px] font-medium text-ink">{name}</p>

        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              inputMode="numeric"
              value={draft}
              onChange={(e) => handleAmountChange(e, draft, setDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); save() }
                if (e.key === 'Escape') setEditing(false)
              }}
              placeholder="0"
              className="tnum w-28 rounded-input border border-line bg-canvas px-2 py-1 text-right text-[13px]"
            />
            <button onClick={save} className="rounded-button bg-accent px-2.5 py-1 text-[12px] font-semibold text-white">
              {t('save')}
            </button>
            <button onClick={() => setEditing(false)} className="text-[12px] text-ink-subtle">
              {t('cancel')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={startEdit}
              className={`tnum text-[13px] font-medium ${over ? 'text-negative' : 'text-ink-subtle'} hover:text-ink`}
            >
              {limit > 0 ? `${formatIDR(spent, locale)} / ${formatIDR(limit, locale)}` : t('setBudget')}
            </button>
            {limit > 0 && (
              <button
                onClick={remove}
                aria-label={t('delete')}
                className="ml-1 grid size-6 place-items-center rounded-input text-ink-subtle opacity-60 transition hover:bg-canvas hover:text-negative group-hover:opacity-100"
              >
                <Trash2 size={12} strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}
      </div>
      {!editing && limit > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-budget-soft">
          <div
            className={`h-full rounded-pill ${over ? 'bg-negative' : pct >= 80 ? 'bg-warning' : 'bg-budget'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </li>
  )
}
