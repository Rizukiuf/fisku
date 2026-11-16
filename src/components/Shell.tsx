import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { BottomNav, type Page } from './BottomNav'
import { SyncStatus } from './SyncStatus'
import { BrandLogo } from './BrandLogo'
import { useT } from '../lib/i18n'

export function Shell({ page, onChange, onAdd, children }: {
  page: Page
  onChange: (p: Page) => void
  onAdd: () => void
  children: ReactNode
}) {
  const t = useT()
  return (
    <div className="min-h-dvh bg-canvas">
      <Sidebar page={page} onChange={onChange} onAdd={onAdd} />
      <SyncStatus variant="pill" />

      <main className="lg:pl-60">
        <div className="sticky top-0 z-10 flex items-center border-b border-line bg-canvas/80 px-5 py-3 backdrop-blur-md lg:hidden">
          <button
            onClick={() => onChange('dashboard')}
            className="flex items-center gap-2.5 transition hover:opacity-80 active:scale-95"
          >
            <BrandLogo className="size-6 shrink-0" />
            <p className="text-[16px] font-bold tracking-tight text-ink">
              Fis<span className="text-budget">ku</span>
            </p>
          </button>
        </div>

        <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-6xl">{children}</div>
      </main>

      <div className="lg:hidden">
        <BottomNav page={page} onChange={onChange} />
        <button
          onClick={onAdd}
          aria-label={t('add')}
          className="fixed bottom-20 right-5 z-30 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg active:scale-95 transition"
        >
          <Plus size={24} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  )
}
