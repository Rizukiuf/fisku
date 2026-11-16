import { emptyState, dataOf, decodeState, defaults, emptyData, isUuid, requireValue, uid, type Data, type State } from './model'
import { compareBackups, isBackupProtected, isConflictBackup, retainBackups, stateContentKey, type Backup, type BackupView } from './backupPolicy'
import { inferOnboarding, onboardingStatuses, type OnboardingStatus } from './onboarding'
import { checkImportIds, type ImportIds } from './imports'
import { checkMergeAliases, type MergeAliases } from './importAliases'
import { checkGuestReceipt } from './guestImport'
export type { Backup, BackupView } from './backupPolicy'

export type Pending = { id: string; revision: number; data: Data }
export type Workspace = {
  schema: 1; scope: string; version: number; state: State
  base: Data; revision: number; pending: Pending | null; lastSync: string | null
  conflict: { remote: Data; revision: number; ids: string[]; backupGroup?: string } | null
  onboarding?: OnboardingStatus
  importIds?: ImportIds
  mergeIds?: MergeAliases
  guestImport?: string
}
export const DB_NAME = 'fisku.local.v1'
let connection: Promise<IDBDatabase> | null = null
export function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Penyimpanan IndexedDB tidak tersedia. Gunakan browser dengan penyimpanan situs aktif.')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('workspaces', { keyPath: 'scope' })
      request.result.createObjectStore('backups', { keyPath: 'id' })
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Penyimpanan sedang diperbarui di tab lain. Tutup tab Fisku lain lalu muat ulang.'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); connection = null }
      db.onclose = () => { connection = null }
      resolve(db)
    }
  }).catch(error => { connection = null; throw error })
  return connection
}
function legacyGuest(): State {
  // Only a first guest workspace can read legacy data. Never overwrite the raw
  // source, including corrupt JSON; users can export/recover it independently.
  const raw = localStorage.getItem('finance.v3') ?? localStorage.getItem('finance.v2')
  if (raw === null) return emptyState()
  try { return decodeState(JSON.parse(raw)) }
  catch { throw new Error('Data lokal lama tidak valid. Sumber asli dipertahankan. Ekspor data pemulihan sebelum melanjutkan.') }
}
export function newWorkspace(scope: string, state?: State): Workspace {
  requireValue(scope === 'guest' || (scope.startsWith('user:') && isUuid(scope.slice(5))), 'Pemilik penyimpanan tidak valid.')
  const workspace: Workspace = { schema: 1, scope, version: 0, state: state ?? (scope === 'guest' ? legacyGuest() : emptyState()), base: emptyData(), revision: 0, pending: null, lastSync: null, conflict: null }
  workspace.onboarding = inferOnboarding(workspace)
  return workspace
}
export function checkWorkspace(value: unknown, scope: string): Workspace {
  const workspace = value as Workspace
  requireValue(workspace?.schema === 1 && workspace.scope === scope && Number.isSafeInteger(workspace.version) && workspace.version >= 0 && Number.isSafeInteger(workspace.revision) && workspace.revision >= 0, 'Metadata penyimpanan tidak valid; sumber asli tidak diubah.')
  const state = decodeState(workspace.state)
  const base = dataOf(decodeState({ ...workspace.base, settings: defaults }))
  if (workspace.pending) {
    requireValue(isUuid(workspace.pending.id) && Number.isSafeInteger(workspace.pending.revision) && workspace.pending.revision >= 0, 'Antrean sinkronisasi tidak valid.')
    decodeState({ ...workspace.pending.data, settings: defaults })
  }
  if (workspace.conflict) {
    requireValue(Number.isSafeInteger(workspace.conflict.revision) && workspace.conflict.revision >= 0 && Array.isArray(workspace.conflict.ids) && workspace.conflict.ids.every(id => typeof id === 'string'), 'Metadata konflik tidak valid.')
    decodeState({ ...workspace.conflict.remote, settings: defaults })
    requireValue(workspace.conflict.backupGroup === undefined || isUuid(workspace.conflict.backupGroup), 'Metadata perlindungan cadangan tidak valid.')
  }
  requireValue(workspace.onboarding === undefined || onboardingStatuses.includes(workspace.onboarding), 'Status penyiapan awal tidak valid.')
  checkImportIds(workspace.importIds)
  checkMergeAliases(workspace.mergeIds)
  checkGuestReceipt(workspace.guestImport)
  const checked = { ...workspace, state, base }
  return { ...checked, onboarding: inferOnboarding(checked) }
}
export type BackupControl = {
  (reason: string, state?: State): void
  remove(id: string): boolean
  clear(): number
}
type Update<T> = (current: Workspace, backup: BackupControl) => T
// IDB read/modify/write runs under one readwrite transaction across all tabs.
// The callback is synchronous so it cannot accidentally let the transaction close.
export async function updateWorkspace<T>(scope: string, update: Update<T>): Promise<{ workspace: Workspace; result: T; changed: boolean }> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspaces', 'backups'], 'readwrite')
    let output: { workspace: Workspace; result: T; changed: boolean }
    let failure: unknown
    const store = tx.objectStore('workspaces')
    const backupStore = tx.objectStore('backups')
    const request = store.get(scope)
    request.onsuccess = () => {
      const backupRequest = backupStore.getAll()
      backupRequest.onsuccess = () => {
      try {
        const workspace = request.result === undefined ? newWorkspace(scope) : checkWorkspace(request.result, scope)
        const original = JSON.stringify(workspace)
        const onboardingMigration = request.result !== undefined && request.result.onboarding !== workspace.onboarding
        const originalState = structuredClone(workspace.state)
        const originalConflict = workspace.conflict ? { ...workspace.conflict } : null
        const existing = (backupRequest.result as Backup[]).filter(backup => backup.scope === scope).map(item => structuredClone(item))
        const requested: Backup[] = []
        const removed = new Set<string>()
        const backup: BackupControl = Object.assign((reason: string, state = workspace.state) => {
          requested.push({ id: uid(), scope, reason, at: new Date().toISOString(), state: decodeState(structuredClone(state)), order: workspace.version + 1 })
        }, {
          remove(id: string) {
            const item = existing.find(backup => backup.id === id)
            if (!item || removed.has(id)) return false
            requireValue(!isBackupProtected(item, workspace.conflict), 'Cadangan ini dilindungi sampai konflik diselesaikan.')
            removed.add(id); return true
          },
          clear() {
            const available = existing.filter(item => !removed.has(item.id) && !isBackupProtected(item, workspace.conflict))
            available.forEach(item => removed.add(item.id)); return available.length
          },
        })
        const result = update(workspace, backup)
        requireValue(!(result instanceof Promise), 'Callback transaksi harus sinkron.')
        workspace.state = decodeState(workspace.state)
        checkImportIds(workspace.importIds)
        checkMergeAliases(workspace.mergeIds)
        checkGuestReceipt(workspace.guestImport)
        workspace.onboarding = inferOnboarding(workspace)
        const stateChanged = stateContentKey(originalState) !== stateContentKey(workspace.state)
        if (!stateChanged) workspace.state = originalState
        if (workspace.conflict) {
          workspace.conflict.backupGroup = originalConflict?.backupGroup ?? workspace.conflict.backupGroup ?? uid()
          // One-time protection for conflict copies made before backup groups existed.
          if (originalConflict && !originalConflict.backupGroup) {
            for (const item of existing) if (!item.backupGroup && isConflictBackup(item.reason)) item.backupGroup = workspace.conflict.backupGroup
          }
        }
        const additions = requested.filter(item => stateChanged || isConflictBackup(item.reason)).map(item => ({
          ...item, ...(workspace.conflict && isConflictBackup(item.reason) ? { backupGroup: workspace.conflict.backupGroup } : {}),
        }))
        const retained = retainBackups(existing.filter(item => !removed.has(item.id)), additions, workspace.conflict)
        const retainedIds = new Set(retained.map(item => item.id))
        let backupsChanged = false
        // Compare against the unmodified raw records, including legacy protection migration.
        const raw = new Map((backupRequest.result as Backup[]).filter(item => item.scope === scope).map(item => [item.id, item]))
        for (const item of retained) {
          if (JSON.stringify(raw.get(item.id)) !== JSON.stringify(item)) { backupStore.put(item); backupsChanged = true }
        }
        for (const item of raw.values()) if (!retainedIds.has(item.id)) { backupStore.delete(item.id); backupsChanged = true }
        const changed = request.result === undefined || onboardingMigration || original !== JSON.stringify(workspace) || backupsChanged
        if (changed) { workspace.version++; store.put(workspace) }
        output = { workspace, result, changed }
      } catch (error) { failure = error; tx.abort() }
      }
    }
    tx.oncomplete = () => resolve(output)
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Penyimpanan dibatalkan. Data belum disimpan.'))
    tx.onerror = () => { failure ??= tx.error }
  })
}
export async function readWorkspace(scope: string): Promise<Workspace> {
  const db = await openDatabase()
  const existing: unknown = await new Promise((resolve, reject) => {
    const tx = db.transaction('workspaces', 'readonly')
    const request = tx.objectStore('workspaces').get(scope)
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
  })
  if (existing !== undefined) return checkWorkspace(existing, scope)
  return (await updateWorkspace(scope, () => undefined)).workspace
}
export async function listBackups(scope: string): Promise<BackupView[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspaces', 'backups'], 'readonly')
    const request = tx.objectStore('backups').getAll()
    const workspace = tx.objectStore('workspaces').get(scope)
    tx.oncomplete = () => resolve((request.result as Backup[]).filter(b => b.scope === scope).sort(compareBackups).map(item => ({ ...item, protected: isBackupProtected(item, (workspace.result as Workspace | undefined)?.conflict ?? null) })))
    tx.onabort = () => reject(tx.error)
  })
}
export async function closeDatabase(): Promise<void> { if (connection) (await connection).close(); connection = null }
