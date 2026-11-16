import { LayoutDashboard, Receipt, PiggyBank, Settings as Cog } from 'lucide-react'
import { useT, type Key } from '../lib/i18n'

export type Page = 'dashboard' | 'transactions' | 'budgets' | 'settings'

const items: { key: Page; icon: typeof LayoutDashboard; label: Key }[] = [
  { key: 'dashboard', icon: LayoutDashboard, label: 'dashboard' },
  { key: 'transactions', icon: Receipt, label: 'transactions' },
  { key: 'budgets', icon: PiggyBank, label: 'budgets' },
  { key: 'settings', icon: Cog, label: 'settings' },
]

export function BottomNav({ page, onChange }: { page: Page; onChange: (p: Page) => void }) {
  const t = useT()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map(({ key, icon: Icon, label }) => {
          const active = page === key
          return (
            <li key={key} className="flex-1">
              <button onClick={() => onChange(key)} aria-current={active ? 'page' : undefined} className="flex w-full flex-col items-center gap-1 py-2.5">
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} className={active ? 'text-accent' : 'text-ink-subtle'} />
                <span className={`text-[11px] font-medium ${active ? 'text-accent' : 'text-ink-subtle'}`}>{t(label)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
