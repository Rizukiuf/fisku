import { budgetsForMonth, useFinance } from '../lib/store'
import { formatIDR } from '../lib/format'
import { useLocale, useT } from '../lib/i18n'

export function CategoryBreakdown() {
  const s = useFinance()
  const t = useT()
  const locale = useLocale()
  const rows = budgetsForMonth(s).filter((r) => r.limit > 0)

  if (rows.length === 0) {
    return (
      <section className="px-0">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-[13px] font-medium text-ink-muted">{t('categoryBreakdown')}</p>
          <p className="mt-2 text-[12px] text-ink-subtle">{t('noBudget')}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="px-0">
      <div className="rounded-card border border-line bg-surface p-4">
        <p className="text-[13px] font-medium text-ink-muted">{t('categoryBreakdown')}</p>
        <ul className="mt-3 space-y-3">
          {rows.map(({ category, limit, spent }) => {
            const pct = Math.min((spent / limit) * 100, 100)
            const over = spent > limit
            const warning = pct >= 80 && !over
            const fill = over ? 'bg-negative' : warning ? 'bg-warning' : 'bg-budget'
            return (
              <li key={category.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-ink">{category.name}</p>
                  <p className="tnum whitespace-nowrap text-[12px] text-ink-subtle">{formatIDR(spent, locale)} / {formatIDR(limit, locale)}</p>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-budget-soft">
                  <div className={`h-full rounded-pill ${fill}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
