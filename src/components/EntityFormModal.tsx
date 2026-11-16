import { useState, useEffect } from 'react'
import { actions, useFinance } from '../lib/store'
import { formatNumber, parseAmount } from '../lib/format'
import { handleAmountChange } from '../lib/amountInput'
import { useAccountTypeLabel, useT } from '../lib/i18n'
import { toast, perform } from '../lib/ui'
import type { AccountType, TxType, Account, Category } from '../lib/store'

interface Props {
  open: boolean
  onClose: () => void
  type: 'account' | 'category'
  editId?: string | null
  initialCategoryType?: 'income' | 'expense'
  onSaved?: (entity: Account | Category) => void
}

export function EntityFormModal({ open, onClose, type, editId, initialCategoryType = 'expense', onSaved }: Props) {
  const s = useFinance()
  const t = useT()
  const typeLabel = useAccountTypeLabel()

  const [name, setName] = useState('')
  const [accType, setAccType] = useState<AccountType>('cash')
  const [balance, setBalance] = useState('')
  const [catType, setCatType] = useState<TxType>('expense')
  const [saving, setSaving] = useState(false)
  const [original, setOriginal] = useState<Account | Category | undefined>()

  useEffect(() => {
    if (!open) return
    if (editId) {
      if (type === 'account') {
        const acc = s.accounts.find(a => a.id === editId)
        if (acc) {
          setOriginal(acc)
          setName(acc.name)
          setAccType(acc.type)
          setBalance(acc.initialBalance ? formatNumber(acc.initialBalance).replace(/,/g, '.') : '')
        }
      } else {
        const cat = s.categories.find(c => c.id === editId)
        if (cat) {
          setOriginal(cat)
          setName(cat.name)
          setCatType(cat.type)
        }
      }
    } else {
      setOriginal(undefined); setName(''); setAccType('cash'); setBalance(''); setCatType(initialCategoryType)
    }
  }, [open, editId, type, initialCategoryType])

  if (!open) return null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    void perform(async () => {
      const cleanName = name.trim()
      if (!cleanName) return

      if (type === 'account') {
        const exists = s.accounts.some(a => !a.deletedAt && a.id !== editId && a.name.toLowerCase() === cleanName.toLowerCase())
        if (exists) { toast(t('errorAccountExists'), 'error'); return }

        const payload = { name: cleanName, type: accType, initialBalance: parseAmount(balance) }
        if (editId) await actions.updateAccount(editId, payload, original as Account)
        else { const created = await actions.addAccount(payload); onSaved?.(created) }
      } else {
        const exists = s.categories.some(c => !c.deletedAt && c.id !== editId && c.type === catType && c.name.toLowerCase() === cleanName.toLowerCase())
        if (exists) { toast(t('errorCategoryExists'), 'error'); return }

        const payload = { name: cleanName, type: catType }
        if (editId) await actions.updateCategory(editId, payload, original as Category)
        else { const created = await actions.addCategory(payload); onSaved?.(created) }
      }

      toast(t('toastSaved'), 'success')
      onClose()
    }).finally(() => setSaving(false))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 pb-16 sm:pb-0 sm:items-center"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-5 shadow-xl sm:rounded-card"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">
            {type === 'account'
              ? (editId ? t('editAccount') : t('addAccount'))
              : (editId ? t('renameCategory') : t('addCategory'))}
          </h2>
          <button type="button" onClick={onClose} className="text-[13px] font-medium text-ink-subtle hover:text-ink">
            {t('cancel')}
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('name')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px]"
            />
          </div>

          {type === 'account' ? (
            <>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('type')}</label>
                <select
                  value={accType}
                  onChange={(e) => setAccType(e.target.value as AccountType)}
                  className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px]"
                >
                  {(['cash', 'bank', 'ewallet', 'credit'] as AccountType[]).map((tp) => (
                    <option key={tp} value={tp}>{typeLabel(tp)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('startingBalance')}</label>
                <input
                  inputMode="numeric"
                  value={balance}
                  onChange={(e) => handleAmountChange(e, balance, setBalance)}
                  placeholder="0"
                  className="tnum w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px]"
                />
                <p className="mt-1 text-[11px] text-ink-subtle">{t('initialBalanceHint')}</p>
              </div>
            </>
          ) : (
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('type')}</label>
              <select
                value={catType}
                onChange={(e) => setCatType(e.target.value as TxType)}
                className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px]"
              >
                <option value="expense">{t('expense')}</option>
                <option value="income">{t('incomeShort')}</option>
              </select>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="mt-5 w-full rounded-button bg-accent py-2.5 text-[13px] font-semibold text-white hover:opacity-95 transition disabled:opacity-50"
        >
          {t('save')}
        </button>
      </form>
    </div>
  )
}
