import { LayoutDashboard, Receipt, PiggyBank, Settings as Cog, Plus } from 'lucide-react'
import { useT, type Key } from '../lib/i18n'
import type { Page } from './BottomNav'
import { SyncStatus } from './SyncStatus'
import { BrandLogo } from './BrandLogo'

const items: { key: Page; icon: typeof LayoutDashboard; label: Key }[] = [
  { key: 'dashboard', icon: LayoutDashboard, label: 'dashboard' },
  { key: 'transactions', icon: Receipt, label: 'transactions' },
  { key: 'budgets', icon: PiggyBank, label: 'budgets' },
  { key: 'settings', icon: Cog, label: 'settings' },
]

export function Sidebar({ page, onChange, onAdd }: { page: Page; onChange: (p: Page) => void; onAdd: () => void }) {
  const t = useT()
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-6 pt-7 pb-5">
        <button
          onClick={() => onChange('dashboard')}
          className="flex items-center gap-2.5 transition hover:opacity-80 active:scale-95"
        >
          <BrandLogo className="size-7 shrink-0" />
          <p className="text-[20px] font-bold tracking-tight text-ink">
            Fis<span className="text-budget">ku</span>
          </p>
        </button>
      </div>
      <div className="px-4 pb-4">
        <button onClick={onAdd} className="flex w-full items-center justify-center gap-2 rounded-button bg-accent px-3 py-2.5 text-[13px] font-semibold text-white hover:opacity-95 transition">
          <Plus size={16} strokeWidth={2.5} /> {t('add')}
        </button>
      </div>
      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {items.map(({ key, icon: Icon, label }) => {
            const active = page === key
            return (
              <li key={key}>
                <button onClick={() => onChange(key)} aria-current={active ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-[13px] font-medium transition ${active ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-canvas hover:text-ink'}`}>
                  <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                  {t(label)}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="border-t border-line px-4 py-3">
        <SyncStatus variant="inline" />
      </div>
    </aside>
  )
}
