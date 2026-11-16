import { useEffect, useId, useRef, useState } from 'react'
import { actions, dismissOnboarding, getGeneration, getScope, useOnboardingPrompt } from '../lib/store'
import { useMessage, useT } from '../lib/i18n'
import { toast } from '../lib/ui'
import type { StartChoice } from '../lib/onboarding'
import { useAuth } from '../lib/supabase'

export function OnboardingDialog() {
  const prompting = useOnboardingPrompt(); const t = useT()
  const message = useMessage()
  const auth = useAuth(); const open = prompting && !auth.recovery
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId(); const descriptionId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!open) return
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [open])
  if (!open) return null
  const choose = (choice: StartChoice) => {
    if (busy) return
    const owner = getScope(); const token = getGeneration()
    setBusy(true); setError(null)
    void actions.chooseStart(choice, owner, token).then(changed => {
      if (changed && choice === 'template' && owner === getScope() && token === getGeneration()) toast(t('templateApplied'), 'success')
    }).catch(failure => setError(failure instanceof Error ? failure.message : t('onboardingSaveFailed'))).finally(() => setBusy(false))
  }
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-card border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/50" onCancel={event => { event.preventDefault(); if (!busy) dismissOnboarding() }} onClick={event => {
    if (event.target !== event.currentTarget || busy) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismissOnboarding()
  }}>
    <h2 id={titleId} className="text-[16px] font-semibold">{t('onboardingTitle')}</h2>
    <p id={descriptionId} className="mt-2 text-[13px] leading-relaxed text-ink-muted">{t('onboardingHint')}</p>
    {error && <p role="alert" className="mt-3 text-[12px] text-negative">{message(error)}</p>}
    <button aria-label={t('useDefaultTemplate')} aria-describedby={`${descriptionId}-template`} disabled={busy} onClick={() => choose('template')} className="mt-5 w-full rounded-button bg-accent px-3 py-3 text-left text-white disabled:opacity-50">
      <span className="block text-[13px] font-semibold">{t('useDefaultTemplate')}</span>
      <span id={`${descriptionId}-template`} className="mt-1 block text-[12px]">{t('onboardingTemplateHint')}</span>
    </button>
    <button aria-label={t('startEmpty')} aria-describedby={`${descriptionId}-empty`} disabled={busy} onClick={() => choose('empty')} className="mt-3 w-full rounded-button border border-line px-3 py-3 text-left disabled:opacity-50">
      <span className="block text-[13px] font-semibold">{t('startEmpty')}</span>
      <span id={`${descriptionId}-empty`} className="mt-1 block text-[12px] text-ink-muted">{t('onboardingEmptyHint')}</span>
    </button>
    <button disabled={busy} onClick={dismissOnboarding} className="mt-4 text-[12px] font-medium text-ink-subtle disabled:opacity-50">{t('chooseLater')}</button>
  </dialog>
}
