import { useState } from 'react'
import { actions, useFinance, getWorkspace, getScope, useCloudLoaded, useOnboardingPrompt } from '../lib/store'
import { canApplyDefaultTemplate } from '../lib/setup'
import { useT } from '../lib/i18n'
import { perform, toast } from '../lib/ui'

export function TemplateSetup() {
  const state = useFinance(); const t = useT()
  const cloudLoaded = useCloudLoaded(); const prompting = useOnboardingPrompt()
  const [busy, setBusy] = useState(false)
  if (prompting || (getScope() !== 'guest' && !cloudLoaded) || !canApplyDefaultTemplate(state) || getWorkspace()?.conflict) return null
  return <div className="mt-4 rounded-card border border-line bg-surface p-4">
    <p className="text-[13px] text-ink-muted">{t('templateHint')}</p>
    <button disabled={busy} className="mt-2 rounded-button border border-line px-3 py-2 text-[13px] font-medium text-accent disabled:opacity-50" onClick={() => {
      if (busy) return
      setBusy(true)
      void perform(async () => { await actions.applyDefaultTemplate(); toast(t('templateApplied'), 'success') }).finally(() => setBusy(false))
    }}>{t('useDefaultTemplate')}</button>
  </div>
}
