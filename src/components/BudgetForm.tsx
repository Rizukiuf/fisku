import { useEffect, useRef, useState } from 'react'
import { actions, activeCategories, budgetsForMonth, useFinance } from '../lib/store'
import { parseAmount } from '../lib/format'
import { handleAmountChange } from '../lib/amountInput'
import { useT } from '../lib/i18n'
import { toast, perform } from '../lib/ui'

const NEW_CAT = '__new__'

export function BudgetForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useFinance()
  const t = useT()
  const [selection, setSelection] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const rows = budgetsForMonth(s)
  const existingIds = new Set(rows.filter((r) => r.limit > 0).map((r) => r.category.id))
  const available = activeCategories(s).filter((c) => c.type === 'expense' && !existingIds.has(c.id))

  useEffect(() => {
    if (!open) return
    setSelection(available[0]?.id ?? NEW_CAT)
    setNewName('')
    setAmount('')
  }, [open, available.length])

  useEffect(() => {
    if (selection === NEW_CAT) {
      const id = window.setTimeout(() => nameInputRef.current?.focus(), 50)
      return () => window.clearTimeout(id)
    }
  }, [selection])

  if (!open) return null

  const showNew = selection === NEW_CAT

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    void perform(async () => {
      const num = parseAmount(amount)
      if (!num) return

      if (showNew) {
        const name = newName.trim()
        if (!name) return
        const existing = activeCategories(s).find(
          (c) => c.type === 'expense' && c.name.toLowerCase() === name.toLowerCase(),
        )
        if (existing) {
          toast(t('errorCategoryExists'), 'error')
          return
        } else {
          await actions.addBudgetCategory(name, num)
        }
      } else await actions.setBudget(selection, num)
      onClose()
    }).finally(() => setSaving(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 pb-16 sm:pb-0 sm:items-center" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-t-2xl border border-line bg-surface p-5 shadow-xl lg:rounded-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">{t('addBudget')}</h2>
          <button type="button" onClick={onClose} className="text-[13px] font-medium text-ink-subtle hover:text-ink">{t('cancel')}</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('budgetCategory')}</label>
            <select
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            >
              {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW_CAT}>{t('newBudgetCategory')}</option>
            </select>
            {available.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-subtle">{t('allCategoriesHaveBudget')}</p>
            )}
          </div>

          {showNew && (
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('name')}</label>
              <input
                ref={nameInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('budgetCategoryPlaceholder')}
                className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('budgetLimit')}</label>
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => handleAmountChange(e, amount, setAmount)}
              placeholder="0"
              className="tnum w-full rounded-input border border-line bg-canvas px-3 py-2.5 text-[16px] font-semibold text-ink outline-none focus:border-accent"
            />
            <p className="mt-1 text-[11px] text-ink-subtle">{t('budgetLimitHint')}</p>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || !amount || (selection === NEW_CAT && !newName.trim())}
          className="mt-5 w-full rounded-button bg-accent py-3 text-[14px] font-semibold text-white hover:opacity-95 transition disabled:opacity-50"
        >
          {t('save')}
        </button>
      </form>
    </div>
  )
}
