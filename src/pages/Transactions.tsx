import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  useFinance, activeTransactions, activeAccounts, activeCategories, monthKeyOf,
} from '../lib/store'
import { formatIDR } from '../lib/format'
import { TransactionList } from '../components/TransactionList'
import { useLocale, useT } from '../lib/i18n'

export function Transactions({ onAdd, onEdit }: { onAdd: () => void; onEdit: (id: string) => void }) {
  const s = useFinance()
  const t = useT()
  const locale = useLocale()

  const txs = useMemo(() => activeTransactions(s), [s])
  const accounts = useMemo(() => activeAccounts(s), [s])
  const categories = useMemo(() => activeCategories(s), [s])

  const [typeF, setTypeF] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [monthF, setMonthF] = useState<string>('')
  const [accF, setAccF] = useState<string>('')
  const [catF, setCatF] = useState<string>('')

  const months = useMemo(() => {
    const set = new Set<string>()
    txs.forEach((tx) => set.add(monthKeyOf(tx.date)))
    set.add(monthKeyOf(new Date()))
    return Array.from(set).sort().reverse()
  }, [txs])

  const filtered = useMemo(() => {
    return txs
      .filter((tx) => (typeF === 'all' ? true : tx.type === typeF))
      .filter((tx) => (monthF ? monthKeyOf(tx.date) === monthF : true))
      .filter((tx) => (accF ? tx.accountId === accF : true))
      .filter((tx) => (catF ? tx.categoryId === catF : true))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [txs, typeF, monthF, accF, catF])

  const totalIncome  = filtered.filter((x) => x.type === 'income').reduce((a, b) => a + b.amount, 0)
  const totalExpense = filtered.filter((x) => x.type === 'expense').reduce((a, b) => a + b.amount, 0)

  return (
    <div className="px-5 lg:px-8 pt-8 lg:pt-6 pb-28 lg:pb-12">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold text-ink">{t('transactions')}</h1>
        <button onClick={onAdd} className="hidden lg:inline-flex items-center gap-1 rounded-button bg-accent px-3 py-2 text-[13px] font-semibold text-white">
          <Plus size={14} strokeWidth={2.5} /> {t('add')}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <select value={typeF} onChange={(e) => setTypeF(e.target.value as 'all' | 'income' | 'expense' | 'transfer')} className="rounded-input border border-line bg-surface px-3 py-2 text-[13px] text-ink">
          <option value="all">{t('all')}</option>
          <option value="income">{t('incomeShort')}</option>
          <option value="expense">{t('expense')}</option>
          <option value="transfer">{t('transfer')}</option>
        </select>
        <select value={monthF} onChange={(e) => setMonthF(e.target.value)} className="rounded-input border border-line bg-surface px-3 py-2 text-[13px] text-ink">
          <option value="">{t('allMonths')}</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={accF} onChange={(e) => setAccF(e.target.value)} className="rounded-input border border-line bg-surface px-3 py-2 text-[13px] text-ink">
          <option value="">{t('allAccounts')}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={catF} onChange={(e) => setCatF(e.target.value)} className="rounded-input border border-line bg-surface px-3 py-2 text-[13px] text-ink">
          <option value="">{t('allCategories')}</option>
          {categories.some((c) => c.type === 'expense') && (
            <optgroup label={t('sectionExpense')}>
              {categories.filter((c) => c.type === 'expense').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          )}
          {categories.some((c) => c.type === 'income') && (
            <optgroup label={t('sectionIncome')}>
              {categories.filter((c) => c.type === 'income').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="mt-4 flex items-center justify-between border-y border-line py-2.5 text-[12px]">
        <span className="text-ink-muted">{filtered.length} {t('of')} {txs.length}</span>
        <div className="flex tnum gap-4">
          <span className="font-medium text-positive">+{formatIDR(totalIncome, locale)}</span>
          <span className="font-medium text-negative">−{formatIDR(totalExpense, locale)}</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] text-ink-muted">{t('noTransactions')}</p>
          <button onClick={onAdd} className="mt-2 text-[13px] font-medium text-accent">{t('addFirst')}</button>
        </div>
      ) : (
        <TransactionList items={filtered} onEdit={onEdit} />
      )}
    </div>
  )
}
