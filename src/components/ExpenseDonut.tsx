import { useState, useMemo } from 'react'
import { useFinance, activeTransactions, monthKeyOf } from '../lib/store'
import { formatIDR } from '../lib/format'
import { useLocale, useT } from '../lib/i18n'

const COLORS = ['#3B4A9E', '#0F6B63', '#B7791F', '#C24A3A', '#8A96E8', '#9BA1AD']

function smartFormat(n: number, locale: string): string {
  if (Math.abs(n) >= 1_000_000) {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1,
    }).format(n).replace('Rp', '').trim()
  }
  return formatIDR(n, locale).replace('Rp', '').trim()
}

export function ExpenseDonut() {
  const s = useFinance()
  const t = useT()
  const locale = useLocale()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const othersLabel = t('others')

  const { sorted, total } = useMemo(() => {
    const currentMonth = monthKeyOf(new Date())
    const txs = activeTransactions(s).filter(tx => tx.type === 'expense' && monthKeyOf(tx.date) === currentMonth)

    const grouped = txs.reduce((acc, tx) => {
      const cat = s.categories.find(c => c.id === tx.categoryId)
      const name = cat ? cat.name : '—'
      acc.set(name, (acc.get(name) ?? 0) + tx.amount)
      return acc
    }, new Map<string, number>())

    let arr = [...grouped.entries()].sort((a, b) => b[1] - a[1])
    const sum = arr.reduce((acc, [, val]) => acc + val, 0)

    if (arr.length > 5) {
      const top5 = arr.slice(0, 5)
      const othersVal = arr.slice(5).reduce((sum, [, val]) => sum + val, 0)
      arr = [...top5, [othersLabel, othersVal]]
    }
    return { sorted: arr, total: sum }
  }, [s, othersLabel])

  if (total === 0) {
    return (
      <section className="px-0">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-[13px] font-medium text-ink-muted">{t('expenseBreakdown')}</p>
          <p className="mt-2 text-[12px] text-ink-subtle">{t('noTransactions')}</p>
        </div>
      </section>
    )
  }

  const R = 40
  const C = 2 * Math.PI * R
  let cumulativePercent = 0

  return (
    <section className="px-0">
      <div className="rounded-card border border-line bg-surface p-4 flex flex-col items-center">
        <p className="self-start text-[13px] font-medium text-ink-muted mb-2">{t('expenseBreakdown')}</p>

        <div className="relative flex size-32 items-center justify-center">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90">
            {sorted.map(([name, val], i) => {
              const percent = val / total
              const strokeDasharray = `${percent * C} ${C}`
              const strokeDashoffset = -cumulativePercent * C
              cumulativePercent += percent

              const isHovered = hoverIndex === i
              const isAnyHovered = hoverIndex !== null

              return (
                <circle
                  key={name}
                  cx="50" cy="50" r={R}
                  fill="none"
                  stroke={name === othersLabel ? '#9BA1AD' : COLORS[i % COLORS.length]}
                  strokeWidth={isHovered ? "22" : "18"}
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  className={`transition-all duration-300 ease-out cursor-pointer ${isAnyHovered && !isHovered ? 'opacity-30' : 'opacity-100'}`}
                  style={{ pointerEvents: 'stroke' }}
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              )
            })}
            <circle cx="50" cy="50" r="28" fill="var(--color-surface)" className="pointer-events-none" />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <span className="text-[10px] text-ink-subtle leading-tight truncate max-w-[70px]">
              {hoverIndex !== null ? sorted[hoverIndex][0] : 'Total'}
            </span>
            <span className="tnum text-[12px] font-bold text-ink leading-tight px-2 truncate max-w-[80px]">
              {smartFormat(hoverIndex !== null ? sorted[hoverIndex][1] : total, locale)}
            </span>
          </div>
        </div>

        <ul className="mt-4 w-full space-y-1.5">
          {sorted.map(([name, val], i) => {
            const isHovered = hoverIndex === i
            return (
              <li
                key={name}
                className={`flex items-center justify-between text-[12px] cursor-pointer transition-opacity ${hoverIndex !== null && !isHovered ? 'opacity-40' : 'opacity-100'}`}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              >
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: name === othersLabel ? '#9BA1AD' : COLORS[i % COLORS.length] }} />
                  <span className="text-ink-muted truncate max-w-[120px]">{name}</span>
                </div>
                <span className="tnum font-medium text-ink">{Math.round((val / total) * 100)}%</span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
