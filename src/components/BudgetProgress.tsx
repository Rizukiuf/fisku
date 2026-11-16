import { formatIDR } from '../lib/format'
import { useLocale, useT } from '../lib/i18n'

export function BudgetProgress({ used, limit }: { used: number; limit: number }) {
  const t = useT()
  const locale = useLocale()
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const over = used > limit && limit > 0
  const warning = pct >= 80 && !over
  const fill = over ? 'bg-negative' : warning ? 'bg-warning' : 'bg-budget'
  const textTone = over ? 'text-negative' : warning ? 'text-warning' : 'text-ink-muted'

  return (
    <section className="px-0 pt-6 lg:pt-0">
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium text-ink-muted">{t('budgetThisMonth')}</p>
          <p className="tnum text-[13px] font-semibold text-ink">
            {formatIDR(used, locale)}
            <span className="font-normal text-ink-subtle"> / {limit > 0 ? formatIDR(limit, locale) : '—'}</span>
          </p>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-pill bg-budget-soft">
          <div className={`h-full rounded-pill ${fill} transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
        </div>
        <p className={`mt-2 text-[12px] font-medium ${textTone}`}>
          {limit === 0 ? t('noBudget') : over ? `${formatIDR(used - limit, locale)} ${t('over')}` : `${formatIDR(limit - used, locale)} ${t('remaining')}`}
        </p>
      </div>
    </section>
  )
}
