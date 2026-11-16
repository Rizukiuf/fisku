import { useEffect, useState } from 'react'
import { Shell } from './components/Shell'
import { Dashboard } from './pages/Dashboard'
import { Transactions } from './pages/Transactions'
import { Budgets } from './pages/Budgets'
import { Settings } from './pages/Settings'
import { TransactionForm } from './components/TransactionForm'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ToastHost } from './components/ToastHost'
import { OnboardingDialog } from './components/OnboardingDialog'
import { ImportDialog } from './components/ImportDialog'
import { WorkspaceNotice } from './components/WorkspaceNotice'
import type { Page } from './components/BottomNav'
import { useFinance } from './lib/store'
import { useAutoSync } from './hooks/useAutoSync'

function getPageFromHash(): Page {
  const hash = window.location.hash.replace('#/', '')
  if (['transactions', 'budgets', 'settings'].includes(hash)) return hash as Page
  return 'dashboard'
}

export default function App() {
  const s = useFinance()
  const [page, setPageState] = useState<Page>(getPageFromHash())
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [reviewCloud, setReviewCloud] = useState(false)

  useAutoSync()

  useEffect(() => {
    const onHashChange = () => setPageState(getPageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const setPage = (newPage: Page) => {
    const currentPage = getPageFromHash()
    if (newPage === currentPage) return

    if (newPage === 'dashboard') {
      window.history.back()
    } else {
      if (currentPage === 'dashboard') {
        window.history.pushState(null, '', `#/${newPage}`)
      } else {
        window.history.replaceState(null, '', `#/${newPage}`)
      }
      setPageState(newPage)
    }
  }

  useEffect(() => {
    const apply = () => {
      const mode = s.settings.theme
      const resolved = mode === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(resolved)
    }
    apply()
    if (s.settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [s.settings.theme])

  useEffect(() => { document.documentElement.lang = s.settings.lang }, [s.settings.lang])

  const openAdd = () => { setEditId(null); setFormOpen(true) }
  const openEdit = (id: string) => { setEditId(id); setFormOpen(true) }
  useEffect(() => {
    if (!reviewCloud || page !== 'settings') return
    const section = document.getElementById('cloud-sync-section')
    section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: 'start' })
    setReviewCloud(false)
  }, [reviewCloud, page])

  return (
    <>
      <Shell page={page} onChange={setPage} onAdd={openAdd}>
        <WorkspaceNotice onReviewSync={() => { setPage('settings'); setReviewCloud(true) }} />
        {page === 'dashboard' && <Dashboard onAdd={openAdd} onEdit={openEdit} />}
        {page === 'transactions' && <Transactions onAdd={openAdd} onEdit={openEdit} />}
        {page === 'budgets' && <Budgets />}
        {page === 'settings' && <Settings />}
      </Shell>
      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} editId={editId} />
      <ConfirmDialog />
      <ToastHost />
      <OnboardingDialog />
      <ImportDialog />
    </>
  )
}
