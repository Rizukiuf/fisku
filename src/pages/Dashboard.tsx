import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { BalanceVerdict } from '../components/BalanceVerdict'
import { MetricRow } from '../components/MetricRow'
import { BudgetProgress } from '../components/BudgetProgress'
import { CashFlowChart } from '../components/CashFlowChart'
import { CategoryBreakdown } from '../components/CategoryBreakdown'
import { ExpenseDonut } from '../components/ExpenseDonut'
import { TransactionList } from '../components/TransactionList'
import { TemplateSetup } from '../components/TemplateSetup'
import {
  budgetsForMonth, monthlyStats, totalBalance, useFinance,
  activeAccounts, activeTransactions,
} from '../lib/store'
import { useT } from '../lib/i18n'

export function Dashboard({ onAdd, onEdit }: { onAdd: () => void; onEdit: (id: string) => void }) {
  const s = useFinance()
  const t = useT()

  const activeTxs = useMemo(() => activeTransactions(s), [s])
  const bal = useMemo(() => totalBalance(activeAccounts(s), activeTxs), [s, activeTxs])
  const stats = useMemo(() => monthlyStats(activeTxs), [activeTxs])

  const budgetRows = useMemo(() => budgetsForMonth(s), [s])
  const totalBudget = useMemo(() => budgetRows.reduce((sum, r) => sum + r.limit, 0), [budgetRows])
  const totalSpent = useMemo(() => budgetRows.reduce((sum, r) => sum + r.spent, 0), [budgetRows])

  const recent = useMemo(() => {
    return [...activeTxs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
  }, [activeTxs])

  return (
    <div className="px-5 lg:px-8 pt-2 pb-28 lg:pb-12 lg:pt-6">
      <div className="lg:grid lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-8">
          <BalanceVerdict total={bal} />
          <TemplateSetup />
          <MetricRow metrics={[
            { label: t('income'), value: stats.income, tone: 'positive' },
            { label: t('expenses'), value: stats.expense, tone: 'negative' },
            { label: t('budgetLeft'), value: Math.max(0, totalBudget - totalSpent), tone: 'ink' },
          ]} />

          <div className="lg:hidden"><BudgetProgress used={totalSpent} limit={totalBudget} /></div>
          <CashFlowChart transactions={activeTxs} />

          <div className="mt-6 lg:hidden"><ExpenseDonut /></div>
          <div className="mt-6 lg:hidden"><CategoryBreakdown /></div>

          <section className="mt-8">
            <header className="flex items-center justify-between pb-3">
              <h2 className="text-[15px] font-semibold text-ink">{t('recentTransactions')}</h2>
              <button onClick={onAdd} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">
                <Plus size={14} strokeWidth={2.5} /> {t('add')}
              </button>
            </header>
            {recent.length === 0 ? (
              <div className="rounded-card border border-dashed border-line bg-surface px-4 py-6 text-center">
                <p className="text-[13px] text-ink-muted">{t('noTransactions')}</p>
                <button onClick={onAdd} className="mt-2 text-[13px] font-medium text-accent">{t('addFirst')}</button>
              </div>
            ) : (
              <TransactionList items={recent} onEdit={onEdit} />
            )}
          </section>
        </div>

        <aside className="hidden lg:col-span-4 lg:block lg:space-y-4 lg:pt-6">
          <BudgetProgress used={totalSpent} limit={totalBudget} />
          <ExpenseDonut />
          <CategoryBreakdown />
        </aside>
      </div>
    </div>
  )
}
