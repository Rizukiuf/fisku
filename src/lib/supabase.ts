import { createClient, type Session as SupabaseSession, type SupabaseClient } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { getScope, getWorkspace, isDirty, isReady, lockWorkspace, switchWorkspace } from './store'
import { setSyncStatus } from './syncStatus'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
export const cloudConfigured = Boolean(url && key)
export let configurationError: string | null = null
async function cloudFetch(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  if (options?.signal) return fetch(input, options)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try { return await fetch(input, { ...options, signal: controller.signal }) }
  finally { clearTimeout(timeout) }
}
export const supabase: SupabaseClient | null = (() => {
  if (!cloudConfigured) return null
  try { return createClient(url!, key!, { global: { fetch: cloudFetch }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) }
  catch { configurationError = 'Konfigurasi Supabase tidak valid. Periksa URL dan public anon key.'; return null }
})()
export type Session = { userId: string; email: string | null } | null
export type AuthSnapshot = { session: Session; loading: boolean; recovery: boolean; error: string | null }
function recoveryRequested(): boolean {
  if (typeof window === 'undefined') return false
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  try { return query.get('auth') === 'recovery' || hash.get('type') === 'recovery' || sessionStorage.getItem('fisku.recovery') === '1' } catch { return query.get('auth') === 'recovery' || hash.get('type') === 'recovery' }
}
let snapshot: AuthSnapshot = { session: null, loading: cloudConfigured, recovery: recoveryRequested(), error: configurationError }
const listeners = new Set<() => void>()
const emit = (patch: Partial<AuthSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(callback => callback()) }
export const useAuth = () => useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback) } }, () => snapshot)
export const getAuth = () => snapshot
let transition: Promise<void> = Promise.resolve()
let sequence = 0
let initialized: Promise<void> | null = null
function adoptSession(session: SupabaseSession | null, recovery = false): Promise<void> {
  const token = ++sequence
  const requestedScope = session ? `user:${session.user.id}` : 'guest'
  const mustLoad = getScope() !== requestedScope || !isReady()
  if (mustLoad) lockWorkspace()
  emit({ loading: mustLoad, session: session ? { userId: session.user.id, email: session.user.email ?? null } : null, recovery: recovery || (snapshot.recovery && Boolean(session)), error: null })
  transition = transition.catch(() => {}).then(async () => {
    if (token !== sequence) return
    if (mustLoad) await switchWorkspace(session?.user.id ?? null)
    if (token !== sequence) return
    if (mustLoad) setSyncStatus({ status: isDirty() ? 'idle' : 'ok', lastSync: getWorkspace()?.lastSync ?? null, error: null, autoRetryBlocked: false })
    emit({ loading: false })
  }).catch(error => { if (token === sequence) emit({ loading: false, error: error instanceof Error ? error.message : 'Gagal memuat data pengguna.' }); throw error })
  // Auth callbacks must return synchronously to avoid the SDK auth lock.
  void transition.catch(() => {})
  return transition
}
export function initializeAuth(): Promise<void> {
  if (initialized) return initialized
  initialized = (async () => {
    if (!supabase) { emit({ loading: false }); return }
    let observed = false
    supabase.auth.onAuthStateChange((event, session) => {
      observed = true
      const recovery = event === 'PASSWORD_RECOVERY'
      if (recovery) { try { sessionStorage.setItem('fisku.recovery', '1') } catch { /* Optional recovery hint. */ } }
      queueMicrotask(() => { void adoptSession(session, recovery).catch(() => {}) })
    })
    const authInitialization = await supabase.auth.initialize()
    const { data, error } = await supabase.auth.getSession()
    if (!observed) await adoptSession(data.session)
    else await transition
    // An expired or invalid auth link must not prevent local use. Surface the
    // provider error in Settings while keeping the finance workspace intact.
    const authError = authInitialization.error ?? error
    if (authError) {
      emit({ loading: false, error: authError.message })
      window.location.hash = '/settings'
    }
  })()
  return initialized
}
function client(): SupabaseClient { if (!supabase) throw new Error(configurationError ?? 'Cloud tidak dikonfigurasi.'); return supabase }
const redirectUrl = (recovery = false) => `${window.location.origin}${window.location.pathname}${recovery ? '?auth=recovery' : '?auth=confirm'}`
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw error
  await transition
}
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await client().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectUrl() } })
  if (error) throw error
  await transition
  return Boolean(data.session)
}
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl(true) })
  if (error) throw error
}
export async function updatePassword(password: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password })
  if (error) throw error
  try { sessionStorage.removeItem('fisku.recovery') } catch { /* Optional recovery hint. */ }
  const url = new URL(window.location.href); url.searchParams.delete('auth'); window.history.replaceState(null, '', `${url.pathname}${url.search}#/settings`)
  emit({ recovery: false })
}
export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut()
  if (error) throw error
  try { sessionStorage.removeItem('fisku.recovery') } catch { /* Optional recovery hint. */ }
  await transition
}
