import { useEffect, useId, useState } from 'react'
import { actions, useFinance, activeAccounts, activeCategories, type TxType, type Transaction } from '../lib/store'
import { formatNumber, parseAmount, today } from '../lib/format'
import { handleAmountChange } from '../lib/amountInput'
import { useT } from '../lib/i18n'
import { perform } from '../lib/ui'
import { EntityFormModal } from './EntityFormModal'

export function TransactionForm({ open, onClose, editId }: { open: boolean; onClose: () => void; editId?: string | null }) {
  const s = useFinance()
  const t = useT()
  const accounts = activeAccounts(s)
  const editing = editId ? s.transactions.find((tx) => tx.id === editId) : null
  const formId = useId()

  const [type, setType] = useState<TxType>('expense')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState('')
  const [targetAccountId, setTargetAccountId] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [original, setOriginal] = useState<Transaction | undefined>()
  const [creator, setCreator] = useState<'account' | 'target' | 'category' | null>(null)

  useEffect(() => {
    if (!open) return
    setOriginal(editing ?? undefined)
    setCreator(null)

    if (editing) {
      setType(editing.type)
      setAmount(editing.amount ? formatNumber(editing.amount).replace(/,/g, '.') : '')
      setAccountId(editing.accountId)
      setCategoryId(editing.categoryId ?? '')
      setTargetAccountId(editing.targetAccountId ?? '')
      setDate(editing.date)
      setNote(editing.note ?? '')
    } else {
      setType('expense'); setAmount(''); setAccountId(accounts[0]?.id ?? '')
      const first = activeCategories(s).find((c) => c.type === 'expense')
      setCategoryId(first?.id ?? ''); setDate(today()); setNote('')

      const diff = accounts.find(a => a.id !== accounts[0]?.id)
      setTargetAccountId(diff?.id ?? '')
    }
  }, [open, editId])

  if (!open) return null

  const cats = activeCategories(s).filter((c) => c.type === type)
  const validAccount = accounts.some(account => account.id === accountId)
  const validTarget = accounts.some(account => account.id === targetAccountId && account.id !== accountId)
  const validCategory = cats.some(category => category.id === categoryId)
  const missingTransaction = Boolean(editId && (!editing || editing.deletedAt))
  const validReferences = validAccount && (type === 'transfer' ? validTarget : validCategory) && !missingTransaction
  const chooseType = (nextType: TxType) => {
    if (nextType === type) return
    setType(nextType)
    if (nextType !== 'transfer') setCategoryId(activeCategories(s).find(category => category.type === nextType)?.id ?? '')
    else if (!validTarget) setTargetAccountId(accounts.find(account => account.id !== accountId)?.id ?? '')
  }
  const addButtonClass = 'mt-1 text-[12px] font-medium text-accent'
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    void perform(async () => {
      const num = parseAmount(amount)
      if (missingTransaction) throw new Error(t('transactionUnavailable'))
      if (!validAccount) throw new Error(t('selectAvailableAccount'))
      if (num <= 0) throw new Error(t('positiveAmountRequired'))

      if (type === 'transfer') {
        if (!validTarget) throw new Error(t('transferNeedsAccounts'))
        const payload = { type, amount: num, accountId, targetAccountId, date, note }
        if (editing) await actions.updateTransaction(editing.id, payload, original)
        else await actions.addTransaction(payload)
      } else {
        if (!validCategory) throw new Error(t('selectAvailableCategory'))
        const payload = { type, amount: num, accountId, categoryId, date, note }
        if (editing) await actions.updateTransaction(editing.id, payload, original)
        else await actions.addTransaction(payload)
      }
      onClose()
    }).finally(() => setSaving(false))
  }

  return (
    <>
    {!creator && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 pb-16 sm:pb-0 sm:items-center" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="w-full max-w-lg rounded-t-2xl border border-line bg-surface p-5 shadow-xl lg:rounded-card lg:shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">{editing ? t('editTransaction') : t('addTransaction')}</h2>
          <button type="button" onClick={onClose} className="text-[13px] font-medium text-ink-subtle hover:text-ink">{t('cancel')}</button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 rounded-button bg-canvas p-1">
          {(['expense', 'income', 'transfer'] as TxType[]).map((opt) => (
            <button key={opt} type="button" onClick={() => chooseType(opt)}
              className={`rounded-[6px] py-2 text-[13px] font-medium transition ${type === opt ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}>
              {opt === 'expense' ? t('expense') : opt === 'income' ? t('incomeShort') : t('transfer')}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('amount')}</label>
            <input inputMode="numeric" value={amount}
              onChange={(e) => handleAmountChange(e, amount, setAmount)}
              placeholder="0" className="tnum w-full rounded-input border border-line bg-canvas px-3 py-2.5 text-[18px] font-semibold text-ink outline-none focus:border-accent" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${formId}-account`} className="mb-1 block text-[12px] font-medium text-ink-muted">{type === 'transfer' ? t('fromAccount') : t('account')}</label>
              <select id={`${formId}-account`} value={validAccount ? accountId : ''} disabled={!accounts.length} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent">
                {!validAccount && <option value="" disabled>{accounts.length ? t('selectAccount') : t('noAccountsYet')}</option>}
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {!validAccount && <p role="status" className="mt-1 text-[11px] text-ink-subtle">{accounts.length ? t(accountId ? 'selectAvailableAccount' : 'selectAccount') : t('accountRequiredHint')}</p>}
              {!accounts.length && <button type="button" className={addButtonClass} onClick={() => setCreator('account')}>{t('addAccount')}</button>}
            </div>
            {type === 'transfer' ? (
              <div>
                <label htmlFor={`${formId}-target`} className="mb-1 block text-[12px] font-medium text-ink-muted">{t('toAccount')}</label>
                <select id={`${formId}-target`} value={validTarget ? targetAccountId : ''} disabled={accounts.length < 2 || !validAccount} onChange={(e) => setTargetAccountId(e.target.value)} className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent">
                  {!validTarget && <option value="" disabled>{t('selectTargetAccount')}</option>}
                  {accounts.filter(a => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {!validTarget && <p role="status" className="mt-1 text-[11px] text-ink-subtle">{accounts.length < 2 ? t('transferNeedsAccounts') : t('selectTargetAccount')}</p>}
                {accounts.length === 1 && <button type="button" className={addButtonClass} onClick={() => setCreator('target')}>{t('addAccount')}</button>}
              </div>
            ) : (
              <div>
                <label htmlFor={`${formId}-category`} className="mb-1 block text-[12px] font-medium text-ink-muted">{t('category')}</label>
                <select id={`${formId}-category`} value={validCategory ? categoryId : ''} disabled={!cats.length} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent">
                  {!validCategory && <option value="" disabled>{cats.length ? t('selectCategory') : t('noCategoriesYet')}</option>}
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {!validCategory && <p role="status" className="mt-1 text-[11px] text-ink-subtle">{cats.length ? t(categoryId ? 'selectAvailableCategory' : 'selectCategory') : t(type === 'income' ? 'incomeCategoryRequiredHint' : 'expenseCategoryRequiredHint')}</p>}
                {!cats.length && <button type="button" className={addButtonClass} onClick={() => setCreator('category')}>{t('addCategory')}</button>}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('date')}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-muted">{t('note')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent" />
          </div>
        </div>

        {missingTransaction && <p role="status" className="mt-3 text-[12px] text-negative">{t('transactionUnavailable')}</p>}
        <button type="submit" disabled={saving || !amount || !validReferences} className="mt-5 w-full rounded-button bg-accent py-3 text-[14px] font-semibold text-white hover:opacity-95 transition disabled:opacity-50">
          {t('save')}
        </button>
      </form>
    </div>}
    <EntityFormModal open={Boolean(creator)} type={creator === 'category' ? 'category' : 'account'} initialCategoryType={type === 'income' ? 'income' : 'expense'} onClose={() => setCreator(null)} onSaved={entity => {
      if (creator === 'category') setCategoryId(entity.id)
      else if (creator === 'target') setTargetAccountId(entity.id)
      else setAccountId(entity.id)
    }} />
    </>
  )
}
