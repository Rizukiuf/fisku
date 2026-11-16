import { formatIDR } from '../lib/format'
import { useLocale, useT } from '../lib/i18n'

export function BalanceVerdict({ total }: { total: number }) {
  const t = useT()
  const locale = useLocale()
  return (
    <section className="px-0 pt-8 pb-2">
      <p className="text-[13px] font-medium text-ink-muted tracking-wide">{t('totalBalance')}</p>
      <div className="mt-1">
        <h1 className="tnum text-[40px] leading-[1.05] font-bold text-ink">{formatIDR(total, locale)}</h1>
      </div>
    </section>
  )
}
