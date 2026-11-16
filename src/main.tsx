import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StartupPanel } from './components/StartupPanel'
import { initializeFinance, getScope, isReady, useFinance } from './lib/store'
import { initializeAuth, useAuth } from './lib/supabase'
import { toast } from './lib/ui'
import './index.css'

function ensureDashboardBase() {
  const page = window.location.hash.replace(/^#\/?/, '')
  if (['transactions', 'budgets', 'settings'].includes(page)) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/dashboard`)
    window.history.pushState(null, '', `#/${page}`)
  } else window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/dashboard`)
}
function Application() {
  const auth = useAuth()
  useFinance()
  useEffect(() => {
    if (auth.recovery) window.location.hash = '/settings'
  }, [auth.recovery])
  if (!isReady() || auth.loading) return <StartupPanel error={auth.error} />
  return <App key={getScope()} />
}
const root = createRoot(document.getElementById('root')!)
root.render(<StartupPanel />)
window.addEventListener('fisku:error', event => {
  const error = (event as CustomEvent).detail
  toast(error instanceof Error ? error.message : 'Gagal memuat perubahan data.', 'error', 6000)
})
async function start() {
  try {
    await initializeFinance()
    // Process confirmation/recovery parameters before hash navigation changes the URL.
    await initializeAuth()
    ensureDashboardBase()
    root.render(<StrictMode><Application /></StrictMode>)
  } catch (error) {
    root.render(<StartupPanel error={error instanceof Error ? error.message : 'Gagal membuka penyimpanan lokal.'} />)
  }
}
void start()
