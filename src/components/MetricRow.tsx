import { formatIDR } from '../lib/format'
import { useLocale } from '../lib/i18n'

type Metric = { label: string; value: number; tone: 'ink' | 'positive' | 'negative' }

function smartFormat(n: number, locale: string): string {
  if (Math.abs(n) >= 1_000_000) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'IDR',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n)
  }
  return formatIDR(n, locale)
}

export function MetricRow({ metrics }: { metrics: Metric[] }) {
  const locale = useLocale()
  return (
    <section className="px-0 pt-4">
      <div className="grid grid-cols-3 divide-x divide-line border-y border-line">
        {metrics.map((m) => (
          <div key={m.label} className="min-w-0 py-4 pl-4 pr-3 first:pl-0">
            <p className="truncate text-[11px] font-medium text-ink-muted sm:text-[12px]">{m.label}</p>
            <p
              className={`tnum mt-1 truncate text-[13px] font-semibold sm:text-[14px] lg:text-[15px] ${
                m.tone === 'positive' ? 'text-positive' : m.tone === 'negative' ? 'text-negative' : 'text-ink'
              }`}
              title={formatIDR(m.value, locale)}
            >
              {smartFormat(m.value, locale)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
