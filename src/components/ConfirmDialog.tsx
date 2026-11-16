import { useUI, resolveConfirm } from '../lib/ui'
import { useMessage, useT } from '../lib/i18n'

export function ConfirmDialog() {
  const { confirm } = useUI()
  const t = useT()
  const message = useMessage()
  if (!confirm) return null

  const { options } = confirm
  const danger = options.tone === 'danger'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={() => resolveConfirm(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl"
      >
        <h2 className="text-[15px] font-semibold text-ink">{message(options.title)}</h2>
        {options.description && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{message(options.description)}</p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => resolveConfirm(false)}
            className="flex-1 rounded-button border border-line py-2 text-[13px] font-medium text-ink-muted hover:text-ink transition"
          >
            {message(options.cancelLabel ?? t('cancel'))}
          </button>
          <button
            onClick={() => resolveConfirm(true)}
            className={`flex-1 rounded-button py-2 text-[13px] font-semibold text-white transition ${danger ? 'bg-negative hover:opacity-95' : 'bg-accent hover:opacity-95'}`}
          >
            {message(options.confirmLabel ?? t('ok'))}
          </button>
        </div>
      </div>
    </div>
  )
}
