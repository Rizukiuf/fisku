import { useSyncExternalStore } from 'react'
import { canonicalTransaction, emptyState, dataOf, decodeState, entityKeys, now, requireValue, uid, type Account, type Budget, type Category, type EntityKey, type State, type Syncable, type Transaction } from './model'
import { readWorkspace, updateWorkspace, type Workspace } from './repository'
import { same } from './reconcile'
import { clearUI } from './ui'
import { resetToEmpty } from './reset'
import { restoreDeleted, type RestoreAllResult } from './restore'
import { applyDefaultTemplate } from './setup'
import type { StartChoice } from './onboarding'
import { parseImport, purgedImportCount, replaceState, restoreImport } from './imports'
import { allocateMergeIds, buildMergePlan } from './mergeImport'
import type { ImportMode, ImportReview, MergeChoices } from './mergeTypes'
import { stateContentKey } from './backupPolicy'
import { fingerprintGuest } from './guestImport'

export * from './model'
export type RestoreReason = 'not_found' | 'account_missing' | 'category_missing' | 'target_account_missing'
export type RestoreResult = { ok: boolean; reason?: RestoreReason }
let scope = 'guest'
let generation = 0
let ready = false
let cloudLoaded = false
let onboardingDismissed = false
let workspace: Workspace | null = null
let state: State = emptyState()
const listeners = new Set<() => void>()
export const subscribeStore = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback) } }
const emit = () => listeners.forEach(listener => listener())
export const getState = () => state
export const getScope = () => scope
export const getGeneration = () => generation
export const isReady = () => ready
export const getWorkspace = () => workspace
export const useFinance = () => useSyncExternalStore(subscribeStore, getState)
export const hasLoadedCloud = () => cloudLoaded
export const useCloudLoaded = () => useSyncExternalStore(subscribeStore, hasLoadedCloud)
export const shouldPromptOnboarding = () => ready && workspace?.onboarding === 'pending' && !onboardingDismissed && (scope === 'guest' || cloudLoaded)
export const useOnboardingPrompt = () => useSyncExternalStore(subscribeStore, shouldPromptOnboarding)
export function dismissOnboarding() { onboardingDismissed = true; emit() }
export function markCloudLoaded(expectedScope: string, token: number) {
  if (!ready || scope !== expectedScope || token !== generation) return
  cloudLoaded = true; emit()
}
let channel: BroadcastChannel | null = null
function publish(next: Workspace) {
  if (next.scope !== scope || (workspace && next.version < workspace.version)) return
  workspace = next; state = next.state; emit()
}
export async function initializeFinance(): Promise<void> {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' && !channel) {
    channel = new BroadcastChannel('fisku.local.changes')
    channel.onmessage = event => {
      if (event.data?.scope !== scope || !ready) return
      const requestedScope = scope; const token = generation
      readWorkspace(requestedScope).then(next => { if (token === generation) publish(next) }).catch(error => {
        window.dispatchEvent(new CustomEvent('fisku:error', { detail: error }))
      })
    }
  }
  await switchWorkspace(null)
}
export async function switchWorkspace(userId: string | null): Promise<void> {
  const requestedScope = userId ? `user:${userId}` : 'guest'
  const token = ++generation
  ready = false; workspace = null; cloudLoaded = false; onboardingDismissed = false
  // Remove the previous owner's data immediately, including during a failed load.
  scope = requestedScope; state = emptyState(); emit()
  // Apply backup retention to this owner on load, including older installations.
  const loaded = await updateWorkspace(requestedScope, () => undefined)
  if (token !== generation) return
  publish(loaded.workspace); ready = true; emit()
  if (loaded.changed) channel?.postMessage({ scope: requestedScope })
}
export function lockWorkspace(): void {
  clearUI()
  generation++; ready = false; workspace = null; cloudLoaded = false; onboardingDismissed = false
  state = emptyState(); emit()
}
export async function commitWorkspace<T>(expectedScope: string, token: number, update: Parameters<typeof updateWorkspace<T>>[1]): Promise<T> {
  requireValue(ready && expectedScope === scope && token === generation, 'Sesi berubah atau penyimpanan belum siap. Coba lagi setelah pemuatan selesai.')
  const result = await updateWorkspace(expectedScope, (current, backup) => {
    requireValue(ready && expectedScope === scope && token === generation, 'Sesi berubah; operasi dibatalkan.')
    return update(current, backup)
  })
  if (expectedScope === scope && token === generation) publish(result.workspace)
  if (result.changed) channel?.postMessage({ scope: expectedScope })
  return result.result
}
async function mutate<T>(update: (next: State, backup: (reason: string, state?: State) => void) => T): Promise<T> {
  const expectedScope = scope; const token = generation
  return commitWorkspace(expectedScope, token, (current, backup) => {
    const result = update(current.state, backup)
    current.state = decodeState(current.state)
    return result
  })
}
function existing<T extends Syncable>(rows: T[], id: string): T {
  const row = rows.find(item => item.id === id)
  requireValue(row, 'Data sudah tidak tersedia. Muat ulang daftar.')
  return row
}
function checkUnchanged<T extends Syncable>(before: T | null | undefined, current: T): void {
  requireValue(before && same(before, current), 'Data berubah di tab lain. Periksa versi terbaru sebelum menyimpan kembali.')
}
function tombstone(row: Syncable, at: string) { if (!row.deletedAt) { row.deletedAt = at; row.updatedAt = at } }
function purge(next: State, key: EntityKey, ids: Set<string>) {
  if (key === 'accounts') requireValue(!next.transactions.some(t => ids.has(t.accountId) || (t.targetAccountId && ids.has(t.targetAccountId))), 'Musnahkan transaksi terkait sebelum memusnahkan akun.')
  if (key === 'categories') requireValue(!next.transactions.some(t => t.categoryId && ids.has(t.categoryId)) && !next.budgets.some(b => ids.has(b.categoryId)), 'Musnahkan transaksi dan anggaran terkait sebelum memusnahkan kategori.')
  next.purged[key] = [...new Set([...next.purged[key], ...ids])].sort()
  ;(next[key] as Syncable[]) = next[key].filter(row => !ids.has(row.id))
}
export type ImportOptions = { restoreAsNew?: boolean; expectedScope?: string; expectedGeneration?: number; mode?: ImportMode; mergeChoices?: MergeChoices }
export const actions = {
  replaceAll(next: State) { return mutate((current, backup) => { backup('before-replace'); replaceState(current, decodeState(next)) }) },
  addTransaction(input: Omit<Transaction, keyof Syncable>) {
    return mutate(next => { next.transactions.unshift(canonicalTransaction({ ...input, id: uid(), updatedAt: now(), deletedAt: null })) })
  },
  updateTransaction(id: string, patch: Partial<Transaction>, expected?: Transaction) {
    const before = expected ?? state.transactions.find(row => row.id === id)
    return mutate(next => {
      const row = existing(next.transactions, id); checkUnchanged(before, row)
      const value = canonicalTransaction({ ...row, ...patch, id: row.id, deletedAt: row.deletedAt, updatedAt: now() })
      Object.assign(row, value)
    })
  },
  deleteTransaction(id: string) { return mutate(next => tombstone(existing(next.transactions, id), now())) },
  addAccount(input: Omit<Account, keyof Syncable>) {
    return mutate(next => {
      const created: Account = { name: input.name, type: input.type, initialBalance: input.initialBalance, id: uid(), updatedAt: now(), deletedAt: null }
      next.accounts.push(created); return structuredClone(created)
    })
  },
  updateAccount(id: string, patch: Partial<Account>, expected?: Account) {
    const before = expected ?? state.accounts.find(row => row.id === id)
    return mutate(next => { const row = existing(next.accounts, id); checkUnchanged(before, row); Object.assign(row, { name: patch.name ?? row.name, type: patch.type ?? row.type, initialBalance: patch.initialBalance ?? row.initialBalance, updatedAt: now() }) })
  },
  deleteAccount(id: string) {
    return mutate(next => { const at = now(); tombstone(existing(next.accounts, id), at); next.transactions.filter(t => t.accountId === id || t.targetAccountId === id).forEach(t => tombstone(t, at)) })
  },
  addCategory(input: Omit<Category, keyof Syncable>) {
    return mutate(next => { const created: Category = { name: input.name, type: input.type, id: uid(), updatedAt: now(), deletedAt: null }; next.categories.push(created); return structuredClone(created) })
  },
  updateCategory(id: string, patch: Partial<Category>, expected?: Category) {
    const before = expected ?? state.categories.find(row => row.id === id)
    return mutate(next => { const row = existing(next.categories, id); checkUnchanged(before, row); Object.assign(row, { name: patch.name ?? row.name, type: patch.type ?? row.type, updatedAt: now() }) })
  },
  deleteCategory(id: string) {
    return mutate(next => { const at = now(); tombstone(existing(next.categories, id), at); next.transactions.filter(t => t.categoryId === id).forEach(t => tombstone(t, at)); next.budgets.filter(b => b.categoryId === id).forEach(b => tombstone(b, at)) })
  },
  setBudget(categoryId: string, limit: number, expected?: Budget | null) {
    const before = expected === undefined ? state.budgets.find(row => row.categoryId === categoryId) : expected
    return mutate(next => {
      const row = next.budgets.find(b => b.categoryId === categoryId)
      if (row) { checkUnchanged(before, row); Object.assign(row, { limit, deletedAt: limit === 0 ? now() : null, updatedAt: now() }) }
      else { requireValue(!before, 'Anggaran berubah; muat ulang daftar.'); if (limit !== 0) next.budgets.push({ id: uid(), categoryId, limit, updatedAt: now(), deletedAt: null }) }
    })
  },
  // Category creation and its budget commit together, including on quota failures.
  addBudgetCategory(name: string, limit: number) {
    return mutate(next => {
      const id = uid(); const at = now()
      next.categories.push({ id, name, type: 'expense', updatedAt: at, deletedAt: null })
      next.budgets.push({ id: uid(), categoryId: id, limit, updatedAt: at, deletedAt: null })
    })
  },
  removeBudget(categoryId: string) { return actions.setBudget(categoryId, 0) },
  updateSettings(patch: Partial<State['settings']>) { return mutate(next => { next.settings = { ...next.settings, ...patch } }) },
  restoreTransaction(id: string): Promise<RestoreResult> {
    return mutate(next => {
      const row = next.transactions.find(t => t.id === id)
      if (!row) return { ok: false, reason: 'not_found' }
      if (!next.accounts.some(a => a.id === row.accountId && !a.deletedAt)) return { ok: false, reason: 'account_missing' }
      if (row.type === 'transfer' && !next.accounts.some(a => a.id === row.targetAccountId && !a.deletedAt)) return { ok: false, reason: 'target_account_missing' }
      if (row.type !== 'transfer' && !next.categories.some(c => c.id === row.categoryId && c.type === row.type && !c.deletedAt)) return { ok: false, reason: 'category_missing' }
      row.deletedAt = null; row.updatedAt = now(); return { ok: true }
    })
  },
  restoreAccount(id: string): Promise<RestoreResult> { return mutate(next => { const row = existing(next.accounts, id); row.deletedAt = null; row.updatedAt = now(); return { ok: true } }) },
  restoreCategory(id: string): Promise<RestoreResult> { return mutate(next => { const row = existing(next.categories, id); row.deletedAt = null; row.updatedAt = now(); return { ok: true } }) },
  restoreBudget(id: string): Promise<RestoreResult> { return mutate(next => { const row = existing(next.budgets, id); requireValue(row.limit > 0, 'Atur ulang batas anggaran di halaman Anggaran.'); row.deletedAt = null; row.updatedAt = now(); return { ok: true } }) },
  restoreAll(options: { expectedScope?: string; expectedGeneration?: number; expectedState?: State } = {}): Promise<RestoreAllResult> {
    const owner = options.expectedScope ?? scope; const token = options.expectedGeneration ?? generation
    const expected = dataOf(options.expectedState ?? state)
    return commitWorkspace(owner, token, (current, backup) => {
      requireValue(same(dataOf(current.state), expected), 'Data berubah sejak konfirmasi. Periksa Sampah terbaru sebelum memulihkan semua.')
      const { state: restoredState, ...result } = restoreDeleted(current.state)
      if (result.changed) { backup('before-restore-all'); current.state = restoredState }
      return result
    })
  },
  purgeOne(kind: 'account' | 'category' | 'transaction' | 'budget', id: string) {
    const keys = { account: 'accounts', category: 'categories', transaction: 'transactions', budget: 'budgets' } as const
    return mutate(next => { const key = keys[kind]; const row = next[key].find(r => r.id === id); if (!row?.deletedAt) return false; purge(next, key, new Set([id])); return true })
  },
  purgeDeleted() {
    return mutate(next => {
      let count = 0
      for (const key of ['transactions', 'budgets', 'accounts', 'categories'] as const) {
        const ids = new Set(next[key].filter(row => row.deletedAt).map(row => row.id)); count += ids.size; purge(next, key, ids)
      }
      return count
    })
  },
  reset() {
    return commitWorkspace(scope, generation, (current, backup) => {
      if (current.onboarding === 'pending') current.onboarding = 'empty'
      const reset = resetToEmpty(current.state)
      if (!reset.changed) return false
      backup('before-reset')
      current.state = reset.state
      return true
    })
  },
  applyDefaultTemplate() {
    const owner = scope; const token = generation
    return commitWorkspace(owner, token, current => {
      requireValue(owner === 'guest' || cloudLoaded, 'Tunggu pemuatan data cloud selesai sebelum menggunakan template.')
      requireValue(!current.conflict, 'Selesaikan konflik sinkronisasi sebelum menggunakan template.')
      current.state = applyDefaultTemplate(current.state)
      current.onboarding = 'template'
    })
  },
  chooseStart(choice: StartChoice, owner = scope, token = generation) {
    return commitWorkspace(owner, token, current => {
      requireValue(choice === 'template' || choice === 'empty', 'Pilihan penyiapan awal tidak valid.')
      requireValue(owner === 'guest' || cloudLoaded, 'Tunggu pemuatan data cloud selesai sebelum memilih penyiapan awal.')
      if (current.onboarding !== 'pending') return false
      if (choice === 'template') current.state = applyDefaultTemplate(current.state)
      current.onboarding = choice
      return true
    })
  },
  deleteBackup(id: string, expectedScope = scope, token = generation) {
    return commitWorkspace(expectedScope, token, (_workspace, backups) => backups.remove(id))
  },
  deleteBackups(expectedScope = scope, token = generation) {
    return commitWorkspace(expectedScope, token, (_workspace, backups) => backups.clear())
  },
  exportJSON() { return JSON.stringify({ format: 'fisku-backup', version: 1, exportedAt: now(), data: state }, null, 2) },
  async inspectImportJSON(json: string, owner = scope, token = generation) {
    const imported = parseImport(json)
    requireValue(ready && owner === scope && token === generation, 'Sesi berubah; impor dibatalkan.')
    const current = await readWorkspace(owner)
    requireValue(ready && owner === scope && token === generation, 'Sesi berubah; impor dibatalkan.')
    requireValue(owner === 'guest' || cloudLoaded || Boolean(current.lastSync), 'Tunggu pemuatan data cloud pertama selesai sebelum mengimpor cadangan.')
    requireValue(!current.conflict, 'Selesaikan konflik sinkronisasi sebelum mengimpor cadangan.')
    return { purgedRows: purgedImportCount(current.state, imported) }
  },
  async importJSON(json: string, options: ImportOptions = {}): Promise<boolean> {
    requireValue(options.mode === undefined || options.mode === 'merge' || options.mode === 'replace', 'Mode impor tidak valid.')
    const owner = options.expectedScope ?? scope; const token = options.expectedGeneration ?? generation
    if (options.mode === 'merge') {
      const review = await actions.prepareImportReview(json, owner, token)
      await actions.commitImportReview(review, 'merge', options.mergeChoices ?? {})
      return true
    }
    const imported = parseImport(json)
    await commitWorkspace(owner, token, (current, backup) => {
      requireValue(owner === 'guest' || cloudLoaded || Boolean(current.lastSync), 'Tunggu pemuatan data cloud pertama selesai sebelum mengimpor cadangan.')
      requireValue(!current.conflict, 'Selesaikan konflik sinkronisasi sebelum mengimpor cadangan.')
      if (options.restoreAsNew) {
        const restored = restoreImport(current.state, imported, current.importIds)
        backup('before-import')
        current.state = restored.state; current.importIds = restored.ids
      } else { backup('before-import'); replaceState(current.state, imported) }
    })
    return true
  },
  async prepareImportReview(json: string, owner = scope, token = generation, source?: 'guest'): Promise<ImportReview> {
    await actions.inspectImportJSON(json, owner, token)
    const imported = parseImport(json)
    const guestFingerprint = source === 'guest' ? await fingerprintGuest(imported) : undefined
    if (source === 'guest') {
      requireValue(owner.startsWith('user:'), 'Masuk terlebih dahulu untuk mengimpor data tamu.')
      requireValue(guestFingerprint, 'Tidak ada data tamu aktif untuk diimpor.')
    }
    const workspace = await readWorkspace(owner)
    requireValue(ready && owner === scope && token === generation, 'Sesi berubah; impor dibatalkan.')
    const purgedRows = purgedImportCount(workspace.state, imported)
    const review: ImportReview = { scope: owner, generation: token, workspace, imported, allocations: allocateMergeIds(workspace.state, imported), purgedRows }
    if (guestFingerprint) review.guestFingerprint = guestFingerprint
    try {
      if (purgedRows) review.replacement = restoreImport(workspace.state, imported, workspace.importIds)
      else {
        const state = structuredClone(workspace.state); replaceState(state, imported)
        review.replacement = { state: decodeState(state) }
      }
    } catch (error) { review.replaceError = error instanceof Error ? error.message : 'Hasil replace tidak valid.' }
    return review
  },
  async commitImportReview(review: ImportReview, mode: ImportMode, choices: MergeChoices = {}): Promise<void> {
    await commitWorkspace(review.scope, review.generation, (current, backup) => {
      requireValue(mode === 'merge' || mode === 'replace', 'Mode impor tidak valid.')
      requireValue(!review.guestFingerprint || mode === 'merge', 'Impor data tamu hanya mendukung Gabungkan (Merge). Gunakan impor file untuk Ganti (Replace).')
      requireValue(!current.conflict, 'Selesaikan konflik sinkronisasi sebelum mengimpor cadangan.')
      requireValue(stateContentKey(current.state) === stateContentKey(review.workspace.state) && same(current.mergeIds, review.workspace.mergeIds) && same(current.importIds, review.workspace.importIds) && current.guestImport === review.workspace.guestImport, 'Data berubah sejak pratinjau. Perbarui pratinjau sebelum menyimpan.')
      if (mode === 'merge') {
        const plan = buildMergePlan(current, review.imported, choices, review.allocations)
        requireValue(plan.unresolved === 0, 'Selesaikan pilihan pada pratinjau merge sebelum menyimpan.')
        requireValue(plan.errors.length === 0, plan.errors.join(' '))
        backup('before-import'); current.state = decodeState(plan.state); current.mergeIds = plan.aliases
      } else if (review.purgedRows) {
        const restored = restoreImport(current.state, review.imported, review.replacement?.ids ?? current.importIds)
        backup('before-import'); current.state = restored.state; current.importIds = restored.ids
      } else { backup('before-import'); replaceState(current.state, review.imported) }
      if (review.guestFingerprint) current.guestImport = review.guestFingerprint
    })
  },
  async guestImportStatus(owner = scope, token = generation): Promise<{ available: boolean; fingerprint: string | null }> {
    requireValue(owner.startsWith('user:') && ready && owner === scope && token === generation, 'Sesi berubah; pemeriksaan data tamu dibatalkan.')
    const guest = await readWorkspace('guest')
    const fingerprint = await fingerprintGuest(guest.state)
    const current = await readWorkspace(owner)
    requireValue(ready && owner === scope && token === generation, 'Sesi berubah; pemeriksaan data tamu dibatalkan.')
    if (!fingerprint || current.guestImport === fingerprint) return { available: false, fingerprint }
    const plan = buildMergePlan(current, guest.state, {}, allocateMergeIds(current.state, guest.state))
    return { available: plan.unresolved > 0 || plan.errors.length > 0 || stateContentKey(plan.state) !== stateContentKey(current.state), fingerprint }
  },
  async guestImportAvailable(owner = scope, token = generation): Promise<boolean> {
    return (await actions.guestImportStatus(owner, token)).available
  },
  async inspectGuestImport(owner = scope, token = generation): Promise<{ json: string; purgedRows: number }> {
    requireValue(owner.startsWith('user:') && ready && owner === scope && token === generation, 'Masuk terlebih dahulu untuk mengimpor data tamu pada sesi yang aktif.')
    const guest = await readWorkspace('guest')
    const json = JSON.stringify(guest.state)
    return { json, ...await actions.inspectImportJSON(json, owner, token) }
  },
  async importGuest(options: ImportOptions = {}): Promise<void> {
    requireValue(options.mode === undefined || options.mode === 'merge', 'Impor data tamu hanya mendukung Gabungkan (Merge).')
    requireValue(!options.restoreAsNew, 'Gunakan pilihan pemulihan pada pratinjau Merge data tamu.')
    const owner = options.expectedScope ?? scope; const token = options.expectedGeneration ?? generation
    const prepared = await actions.inspectGuestImport(owner, token)
    const review = await actions.prepareImportReview(prepared.json, owner, token, 'guest')
    await actions.commitImportReview(review, 'merge', options.mergeChoices)
  },
}
export function isDirty(current = workspace): boolean { return Boolean(current && (current.pending || !same(dataOf(current.state), current.base))) }
export async function refreshWorkspace(): Promise<void> { const token = generation; const next = await readWorkspace(scope); if (token === generation) publish(next) }
