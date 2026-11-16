import { X } from 'lucide-react'
import { useUI, dismissToast } from '../lib/ui'
import { useMessage, useT } from '../lib/i18n'

export function ToastHost() {
  const { toasts } = useUI()
  const translate = useT(); const message = useMessage()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-center gap-3 rounded-button border px-3.5 py-2.5 text-[13px] font-medium shadow-lg backdrop-blur ${
            t.tone === 'error'
              ? 'border-negative/30 bg-surface text-negative'
              : t.tone === 'success'
              ? 'border-positive/30 bg-surface text-positive'
              : 'border-line bg-surface text-ink'
          }`}
        >
          <span className="min-w-0">{message(t.message)}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 transition"
            aria-label={translate('dismiss')}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
