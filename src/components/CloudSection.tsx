import { useState } from 'react'
import { LogOut, RefreshCw } from 'lucide-react'
import { cloudConfigured, configurationError, requestPasswordReset, signIn, signOut, signUp, updatePassword } from '../lib/supabase'
import { useSession } from '../hooks/useSession'
import { useSync } from '../hooks/useSync'
import { SyncProgress } from './SyncProgress'
import { ConflictDetails } from './ConflictDetails'
import { useGuestImport } from '../hooks/useGuestImport'
import { getGeneration, getWorkspace, useFinance } from '../lib/store'
import { resolveSyncConflict } from '../lib/sync'
import { useLocale, useMessage, useT } from '../lib/i18n'
import { confirmDialog, perform, toast } from '../lib/ui'
import { confirmGuestImport } from '../lib/importConfirm'

export function CloudSection() {
  const { session, loading, recovery, error: authError } = useSession()
  const { status, lastSync, error, autoRetryBlocked, sync, forceFullSync } = useSync()
  const guest = useGuestImport(Boolean(session) && !loading && !recovery)
  useFinance()
  const workspace = getWorkspace(); const conflict = workspace?.conflict
  const t = useT()
  const localize = useMessage(); const locale = useLocale()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const inputClass = 'w-full rounded-input border border-line bg-canvas px-3 py-2 text-[13px]'
  const secondaryClass = 'rounded-button border border-line px-2.5 py-1.5 text-[12px] text-ink-muted hover:text-ink'
  const chooseMode = (next: typeof mode) => { setMode(next); setPassword(''); setConfirmation(''); setMessage('') }
  let content
  if (!cloudConfigured || configurationError) content = <div className="px-4 py-3 text-[12px] leading-relaxed text-ink-subtle">{localize(configurationError ?? t('cloudNotConfigured'))}</div>
  else if (recovery || !session) content = (
    <form noValidate onSubmit={event => {
      event.preventDefault()
      if (sending || loading) return
      const invalidEmail = event.currentTarget.querySelector<HTMLInputElement>('input[type="email"]')?.validity.typeMismatch
      setSending(true); setMessage('')
      void perform(async () => {
        if (!recovery && !email.trim()) throw new Error(t('emailRequired'))
        if (!recovery && invalidEmail) throw new Error(t('emailInvalid'))
        if ((recovery || mode !== 'reset') && !password) throw new Error(t('passwordRequired'))
        if ((mode === 'signup' || recovery) && password.length < 8) throw new Error(t('passwordTooShort'))
        if ((mode === 'signup' || recovery) && password !== confirmation) throw new Error(t('passwordMismatch'))
        if (recovery) { await updatePassword(password); toast(t('passwordUpdated'), 'success') }
        else if (mode === 'reset') { await requestPasswordReset(email); setMessage(t('resetEmailSent')) }
        else if (mode === 'signup') {
          const signedIn = await signUp(email, password)
          setMode('login')
          if (!signedIn) setMessage(t('signupConfirmation'))
        }
        else await signIn(email, password)
        setPassword(''); setConfirmation('')
      }).finally(() => setSending(false))
    }} className="space-y-2 p-3">
      <p className="text-[12px] text-ink-muted">{recovery ? t('newPasswordHint') : t('cloudPasswordHint')}</p>
      {!recovery && <input aria-label={t('email')} type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder={t('emailPlaceholder')} className={inputClass} />}
      {(recovery || mode !== 'reset') && <input aria-label={t('password')} type="password" required minLength={mode === 'login' && !recovery ? undefined : 8} autoComplete={mode === 'login' && !recovery ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={t('password')} className={inputClass} />}
      {(recovery || mode === 'signup') && <input aria-label={t('confirmPassword')} type="password" required minLength={8} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={t('confirmPassword')} className={inputClass} />}
      <button disabled={sending || loading} className="w-full rounded-button bg-accent py-2 text-[13px] font-semibold text-white disabled:opacity-60">
        {sending ? t('sending') : recovery ? t('savePassword') : mode === 'login' ? t('signIn') : mode === 'signup' ? t('signUp') : t('resetPassword')}
      </button>
      {!recovery && <div className="flex flex-wrap gap-2">
        {mode !== 'login' && <button type="button" disabled={sending} onClick={() => chooseMode('login')} className={secondaryClass}>{t('signIn')}</button>}
        {mode !== 'signup' && <button type="button" disabled={sending} onClick={() => chooseMode('signup')} className={secondaryClass}>{t('signUp')}</button>}
        {mode !== 'reset' && <button type="button" disabled={sending} onClick={() => chooseMode('reset')} className={secondaryClass}>{t('forgotPassword')}</button>}
      </div>}
      {message && <p role="status" className="text-[12px] text-positive">{localize(message)}</p>}
      {authError && <p role="alert" className="text-[12px] text-negative">{localize(authError)}</p>}
    </form>
  )
  else content = (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-ink">{session.email ?? session.userId.slice(0, 8)}</p>
          <p className="text-[11px] text-ink-subtle">{lastSync ? `${t('lastSynced')} ${new Date(lastSync).toLocaleString(locale)}` : t('neverSynced')}</p>
        </div>
        <button onClick={() => { void perform(async () => {
          if (!await confirmDialog({ title: t('signOutConfirm'), description: t('signOutHint'), confirmLabel: t('signOut') })) return
          await signOut(); toast(t('toastSignedOut'))
        }) }} className={`inline-flex items-center gap-1 ${secondaryClass}`}>
          <LogOut size={13} /> {t('signOut')}
        </button>
      </div>
      <button onClick={sync} disabled={status === 'syncing'} className="inline-flex w-full items-center justify-center gap-2 rounded-button bg-accent py-2 text-[13px] font-semibold text-white disabled:opacity-60">
        <RefreshCw size={14} className={status === 'syncing' ? 'animate-spin' : ''} />
        {status === 'syncing' ? t('syncing') : status === 'ok' ? t('syncSuccess') : t('syncNow')}
      </button>
      <button onClick={forceFullSync} disabled={status === 'syncing'} className="w-full rounded-button border border-line py-2 text-[12px] font-medium text-ink-muted hover:text-ink disabled:opacity-60">{t('forceSync')}</button>
      <SyncProgress />
      {guest.available && <button disabled={Boolean(conflict)} onClick={() => { void perform(async () => {
        if (!await confirmGuestImport(t)) return
        toast(t('toastImported'), 'success')
      }) }} className="w-full rounded-button border border-line py-2 text-[12px] font-medium text-ink-muted hover:text-ink disabled:opacity-50">{t('importGuest')}</button>}
      {guest.error && <p role="alert" className="text-[12px] text-negative">{localize(guest.error)}</p>}
      {conflict && <div className="space-y-2 rounded-input border border-warning/40 p-3">
        <p className="text-[12px] text-ink-muted">{t('conflictHint')}</p>
        <ConflictDetails workspace={workspace!} />
        <div className="flex flex-wrap gap-2">{(['local', 'remote'] as const).map(choice => <button key={choice} disabled={status === 'syncing'} className={secondaryClass} onClick={() => { void perform(async () => {
          const reviewed = getWorkspace()
          const reviewedGeneration = getGeneration()
          if (!reviewed?.conflict) return
          if (!await confirmDialog({ title: t(choice === 'local' ? 'keepLocal' : 'keepCloud'), description: t('conflictConfirm'), confirmLabel: t('save'), tone: 'danger' })) return
          await resolveSyncConflict(choice, { ...reviewed, generation: reviewedGeneration })
        }) }}>{t(choice === 'local' ? 'keepLocal' : 'keepCloud')}</button>)}</div>
      </div>}
      {(conflict ? authError : error ?? authError) && <p role="alert" className="text-[12px] text-negative">{localize((conflict ? authError : error ?? authError)!)}</p>}
      <p className="text-[11px] text-ink-subtle">{t(autoRetryBlocked ? 'syncAutoPausedAfterTimeout' : 'syncAutoHint')}</p>
    </div>
  )
  return <section id="cloud-sync-section" tabIndex={-1} aria-label={t('cloudSync')} className="mt-4 scroll-mt-16 overflow-hidden rounded-card border border-line bg-surface focus:outline-none"><div className="border-b border-line px-4 py-3"><p className="text-[13px] font-medium text-ink-muted">{t('cloudSync')}</p></div>{content}</section>
}
