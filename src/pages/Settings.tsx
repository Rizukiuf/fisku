import { useState } from 'react'
import { Trash2, Pencil, Plus, Mail, ExternalLink } from 'lucide-react'
import {
  actions, useFinance, activeAccounts, activeCategories, activeTransactions, accountBalance, getScope, getGeneration,
  type Account, type Category,
} from '../lib/store'
import { formatIDR, today } from '../lib/format'
import { useAccountTypeLabel, useLocale, useT } from '../lib/i18n'
import { confirmDialog, toast, perform } from '../lib/ui'
import { EntityFormModal } from '../components/EntityFormModal'
import { BrandLogo } from '../components/BrandLogo'
import { TrashSection } from '../components/TrashSection'
import { CloudSection } from '../components/CloudSection'
import { BackupSection } from '../components/BackupSection'
import { TemplateSetup } from '../components/TemplateSetup'
import { downloadJSON } from '../lib/download'
import { confirmImport } from '../lib/importConfirm'
import { version as appVersion } from '../../package.json'

export function Settings() {
  const s = useFinance()
  const t = useT()
  const accounts = activeAccounts(s)
  const categories = activeCategories(s)

  const [accModal, setAccModal] = useState(false)
  const [editAccId, setEditAccId] = useState<string | null>(null)
  const [catModal, setCatModal] = useState(false)

  const openAddAcc = () => { setEditAccId(null); setAccModal(true) }
  const openEditAcc = (id: string) => { setEditAccId(id); setAccModal(true) }

  const onExport = () => {
    downloadJSON(JSON.parse(actions.exportJSON()), `fisku-backup-${today()}.json`)
    toast(t('toastExporting'))
  }

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const importScope = getScope(); const importGeneration = getGeneration()
    const r = new FileReader()
    r.onload = async () => {
      if (importScope !== getScope() || importGeneration !== getGeneration()) return
      await perform(async () => {
      const json = String(r.result ?? '')
      await actions.inspectImportJSON(json, importScope, importGeneration)
      const ok = await confirmImport(json, importScope, importGeneration, t)
      if (!ok) return
      if (ok) toast(t('toastImported'), 'success')
      else toast(t('errorFileInvalid'), 'error')
      })
    }
    r.onerror = () => toast(t('errorFileInvalid'), 'error')
    r.readAsText(f)
    e.target.value = ''
  }

  const onReset = async () => {
    const ok = await confirmDialog({ title: t('resetConfirm'), description: t('resetHint'), tone: 'danger', confirmLabel: t('resetData') })
    if (!ok) return
    await perform(async () => {
      const changed = await actions.reset()
      toast(t(changed ? 'toastReset' : 'toastAlreadyReset'), changed ? 'success' : 'default')
    })
  }

  return (
    <div className="px-5 lg:px-8 pt-8 lg:pt-6 pb-28 lg:pb-12">
      <div className="lg:max-w-3xl">
        <h1 className="text-[22px] font-bold text-ink">{t('settings')}</h1>

        <CloudSection />
        <TemplateSetup />

        <Section title={t('theme')}>
          <div className="grid grid-cols-3 gap-2 p-3">
            {(['light', 'dark', 'system'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { void perform(() => actions.updateSettings({ theme: m })) }}
                className={`rounded-button border px-3 py-2 text-[13px] font-medium transition ${s.settings.theme === m ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted hover:text-ink'}`}
              >
                {t(m)}
              </button>
            ))}
          </div>
        </Section>

        <Section title={t('language')}>
          <div className="grid grid-cols-2 gap-2 p-3">
            {(['id', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => { void perform(() => actions.updateSettings({ lang: l })) }}
                className={`rounded-button border px-3 py-2 text-[13px] font-medium transition ${s.settings.lang === l ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted hover:text-ink'}`}
              >
                {l === 'id' ? 'Bahasa Indonesia' : 'English'}
              </button>
            ))}
          </div>
        </Section>

        <Section title={t('accounts')}>
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} onEdit={() => openEditAcc(a.id)} />
            ))}
          </ul>
          <div className="border-t border-line p-3">
            <button onClick={openAddAcc} className="inline-flex items-center gap-1.5 rounded-button bg-canvas px-3 py-2 text-[13px] font-medium text-ink hover:bg-line/50 transition">
              <Plus size={14} /> {t('addAccount')}
            </button>
          </div>
        </Section>

        <Section title={t('categories')}>
          {categories.filter((c) => c.type === 'expense').length > 0 && (
            <>
              <div className="border-b border-line bg-canvas px-4 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('sectionExpense')}</p>
              </div>
              <ul className="divide-y divide-line">
                {categories.filter((c) => c.type === 'expense').map((c) => (
                  <CategoryRow key={c.id} category={c} />
                ))}
              </ul>
            </>
          )}
          {categories.filter((c) => c.type === 'income').length > 0 && (
            <>
              <div className="border-y border-line bg-canvas px-4 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('sectionIncome')}</p>
              </div>
              <ul className="divide-y divide-line">
                {categories.filter((c) => c.type === 'income').map((c) => (
                  <CategoryRow key={c.id} category={c} />
                ))}
              </ul>
            </>
          )}
          <div className="border-t border-line p-3">
            <button onClick={() => setCatModal(true)} className="inline-flex items-center gap-1.5 rounded-button bg-canvas px-3 py-2 text-[13px] font-medium text-ink hover:bg-line/50 transition">
              <Plus size={14} /> {t('addCategory')}
            </button>
          </div>
        </Section>

        <Section title={t('data')}>
          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            <button onClick={onExport} className="rounded-button border border-line px-3 py-2 text-[13px] font-medium text-ink-muted hover:text-ink">
              {t('exportData')}
            </button>
            <label className="cursor-pointer rounded-button border border-line px-3 py-2 text-center text-[13px] font-medium text-ink-muted hover:text-ink">
              {t('importData')}
              <input type="file" accept="application/json" onChange={onImport} className="hidden" />
            </label>
          </div>
        </Section>

        <TrashSection />
        <BackupSection />

        <details className="group mt-4 overflow-hidden rounded-card border border-line bg-surface">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium text-ink-muted hover:text-ink select-none">
            <span className="inline-flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="transition-transform group-open:rotate-90">
                <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {t('advancedTools')}
            </span>
          </summary>
          <div className="space-y-2 border-t border-line p-3">
            <button onClick={onReset} className="w-full rounded-button border border-negative/40 px-3 py-2 text-[13px] font-medium text-negative hover:bg-negative/5">
              {t('resetData')}
            </button>
            <button
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t('purgeConfirm'),
                  description: t('purgeHint'),
                  tone: 'danger',
                  confirmLabel: t('purgeDeleted'),
                })
                if (!ok) return
                await perform(async () => {
                const localCount = await actions.purgeDeleted()
                if (localCount === 0) toast(t('toastPurgeNone'))
                else toast(t('toastPurged').replace('{n}', String(localCount)), 'success')
                })
              }}
              className="w-full rounded-button border border-negative/40 px-3 py-2 text-[13px] font-medium text-negative hover:bg-negative/5"
            >
              {t('purgeDeleted')}
            </button>
          </div>
        </details>

        <Section title={t('about')}>
          <div className="flex flex-col items-center p-6 text-center">
            <BrandLogo className="size-16 mb-3 shadow-sm rounded-2xl" />
            <h2 className="text-[20px] font-bold text-ink tracking-tight">Fis<span className="text-budget">ku</span></h2>
            <p className="text-[12px] font-medium text-ink-subtle mt-0.5">{t('version')} {appVersion}</p>

            <p className="mt-4 text-[13px] text-ink-muted leading-relaxed max-w-sm">
              {t('appDescription')}
            </p>

            <p className="mt-4 text-[11px] font-medium text-ink-subtle">
              {t('madeBy')} <span className="text-ink font-semibold">Rizu Lab</span>
            </p>
            <p className="mt-1 text-[10px] text-ink-subtle">{t('madeWith')}</p>
          </div>

          <div className="border-t border-line p-4 space-y-4 bg-canvas/30">
            <div>
              <p className="text-[12px] font-semibold text-ink mb-1">{t('privacyPolicy')}</p>
              <p className="text-[11px] text-ink-muted leading-relaxed">{t('privacyText1')}</p>
              <p className="text-[11px] text-ink-muted leading-relaxed mt-1.5">{t('privacyText2')}</p>
            </div>

            <div className="border-t border-line pt-3">
              <p className="text-[12px] font-semibold text-ink mb-1">{t('terms')}</p>
              <p className="text-[11px] text-ink-muted leading-relaxed">{t('termsText')}</p>
            </div>
          </div>

          <div className="border-t border-line p-4 flex flex-col gap-2">
            <p className="text-[12px] font-semibold text-ink mb-1">{t('contactSupport')}</p>
            <p className="text-[11px] text-ink-muted leading-relaxed mb-1">{t('contactHint')}</p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <a
                href={`mailto:${import.meta.env.VITE_CONTACT_EMAIL || 'email.anda@gmail.com'}`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-button border border-line bg-surface px-3 py-2 text-[12px] font-medium text-ink hover:bg-canvas transition"
              >
                <Mail size={14} /> {import.meta.env.VITE_CONTACT_EMAIL || 'Email'}
              </a>

              <a
                href="https://github.com/Rizukiuf"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-button border border-line bg-surface px-3 py-2 text-[12px] font-medium text-ink hover:bg-canvas transition"
              >
                <ExternalLink size={14} /> GitHub
              </a>
            </div>
          </div>
        </Section>
      </div>

      <EntityFormModal open={accModal} onClose={() => setAccModal(false)} type="account" editId={editAccId} />
      <EntityFormModal open={catModal} onClose={() => setCatModal(false)} type="category" />
    </div>
  )
}

function AccountRow({ account, onEdit }: { account: Account; onEdit: () => void }) {
  const s = useFinance()
  const t = useT()
  const locale = useLocale()
  const typeLabel = useAccountTypeLabel()

  const txs = activeTransactions(s)
  const current = accountBalance(account, txs)
  const diff = current - account.initialBalance

  const del = async () => {
    const ok = await confirmDialog({ title: t('deleteAccountConfirm'), tone: 'danger', confirmLabel: t('delete') })
    if (!ok) return
    await perform(async () => { await actions.deleteAccount(account.id); toast(t('toastDeleted'), 'success') })
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink">{account.name}</p>
        <p className="text-[11px] text-ink-muted mt-0.5">
          {t('currentBalance')}: <span className={`tnum font-semibold ${diff >= 0 ? 'text-ink' : 'text-negative'}`}>{formatIDR(current, locale)}</span>
        </p>
        <p className="text-[10px] text-ink-subtle">
          {typeLabel(account.type)} · {t('startingBalance')}: {formatIDR(account.initialBalance, locale)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onEdit} aria-label={t('edit')} className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-ink">
          <Pencil size={13} strokeWidth={1.75} />
        </button>
        <button onClick={del} aria-label={t('delete')} className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-negative">
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  )
}

function CategoryRow({ category }: { category: Category }) {
  const s = useFinance()
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [original, setOriginal] = useState<Category>(category)

  const start = () => { setOriginal(category); setDraft(category.name); setEditing(true) }
  const save = () => {
    void perform(async () => {
    const n = draft.trim()
    if (n && n !== category.name) {
      const exists = s.categories.some(
        c => !c.deletedAt && c.id !== category.id && c.type === category.type && c.name.toLowerCase() === n.toLowerCase()
      )
      if (exists) {
        toast(t('errorCategoryExists'), 'error')
        setDraft(category.name)
        setEditing(false)
        return
      }
      await actions.updateCategory(category.id, { name: n }, original)
      toast(t('toastSaved'), 'success')
    }
    setEditing(false)
    })
  }
  const del = async () => {
    const ok = await confirmDialog({ title: t('deleteCategoryConfirm'), tone: 'danger', confirmLabel: t('delete') })
    if (!ok) return
    await perform(async () => { await actions.deleteCategory(category.id); toast(t('toastDeleted'), 'success') })
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
            if (e.key === 'Escape') setEditing(false)
          }}
          className="min-w-0 flex-1 rounded-input border border-line bg-canvas px-2 py-1 text-[13px] font-medium"
        />
      ) : (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{category.name}</p>
          <p className="text-[11px] text-ink-subtle">
            {category.type === 'income' ? t('incomeShort') : t('expense')}
          </p>
        </div>
      )}
      <div className="flex items-center gap-1">
        <button onClick={start} aria-label={t('renameCategory')} className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-ink">
          <Pencil size={13} strokeWidth={1.75} />
        </button>
        <button onClick={del} className="grid size-7 place-items-center rounded-input text-ink-subtle hover:bg-canvas hover:text-negative">
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
      <div className="border-b border-line px-4 py-3"><p className="text-[13px] font-medium text-ink-muted">{title}</p></div>
      {children}
    </section>
  )
}
