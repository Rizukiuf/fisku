import { useState, useMemo } from 'react'
import type { Transaction } from '../lib/store'
import { monthKeyOf } from '../lib/store'
import { formatIDR } from '../lib/format'
import { useLocale, useT } from '../lib/i18n'

export function CashFlowChart({ transactions }: { transactions: Transaction[] }) {
  const t = useT()
  const locale = useLocale()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const points = useMemo(() => {
    const now = new Date()
    const arr: { m: string; income: number; expense: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = monthKeyOf(d)
      const label = new Intl.DateTimeFormat(locale, { month: 'short' }).format(d)
      let income = 0, expense = 0
      for (const tx of transactions) {
        if (monthKeyOf(tx.date) !== key || tx.type === 'transfer') continue
        if (tx.type === 'income') income += tx.amount
        else expense += tx.amount
      }
      arr.push({ m: label, income, expense })
    }
    return arr
  }, [transactions, locale])

  const W = 320, H = 96, pad = 12
  const max = Math.max(1, ...points.flatMap((d) => [d.income, d.expense]))
  const x = (i: number) => pad + (i * (W - pad * 2)) / (points.length - 1)
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2)
  const line = (key: 'income' | 'expense') =>
    points.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d[key])}`).join(' ')

  const colWidth = (W - pad * 2) / (points.length - 1)

  const isFirst = hoverIndex === 0
  const isLast = hoverIndex === points.length - 1

  return (
    <section className="px-0 pt-6">
      <div className="relative rounded-card border border-line bg-surface p-4">
        <p className="text-[13px] font-medium text-ink-muted">{t('cashflow')}</p>

        <div className="relative mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('cashflow')}>
            {hoverIndex !== null && (
              <line
                x1={x(hoverIndex)} y1={pad} x2={x(hoverIndex)} y2={H - pad}
                stroke="var(--color-line)" strokeWidth={1} strokeDasharray="4 4"
                className="pointer-events-none"
              />
            )}

            <path d={line('income')}  fill="none" stroke="var(--color-accent)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            <path d={line('expense')} fill="none" stroke="var(--color-ink-subtle)" strokeWidth={1.25} strokeDasharray="3 3" strokeLinecap="round" />

            {points.map((d, i) => (
              <g key={d.m}>
                {hoverIndex === i && (
                  <>
                    <circle cx={x(i)} cy={y(d.income)} r={3.5} fill="var(--color-accent)" className="pointer-events-none" />
                    <circle cx={x(i)} cy={y(d.expense)} r={3.5} fill="var(--color-ink-subtle)" className="pointer-events-none" />
                  </>
                )}
              </g>
            ))}

            {points.map((d, i) => (
              <rect
                key={`hover-${d.m}`}
                x={x(i) - colWidth / 2}
                y={0}
                width={colWidth}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                className="cursor-pointer"
              />
            ))}
          </svg>

          {hoverIndex !== null && (
            <div
              className={`absolute top-0 z-10 flex flex-col gap-1 rounded-button border border-line bg-canvas px-2.5 py-1.5 shadow-md pointer-events-none ${
                isFirst ? 'translate-x-0' :
                isLast ? '-translate-x-full' :
                '-translate-x-1/2'
              }`}
              style={{ left: `${(x(hoverIndex) / W) * 100}%` }}
            >
              <span className="text-[10px] font-semibold text-ink-subtle">{points[hoverIndex].m}</span>
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-accent" />
                <span className="tnum text-[11px] text-ink font-medium">{formatIDR(points[hoverIndex].income, locale)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-ink-subtle" />
                <span className="tnum text-[11px] text-ink font-medium">{formatIDR(points[hoverIndex].expense, locale)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-subtle">
          {points.map((d, i) => (
            <span key={d.m} className={hoverIndex === i ? 'text-ink font-medium' : ''}>{d.m}</span>
          ))}
        </div>
      </div>
    </section>
  )
}
