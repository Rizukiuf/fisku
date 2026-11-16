import { dataOf, type State } from './model'
import { semanticKey } from './reconcile'

export const NORMAL_BACKUP_LIMIT = 5
export type Backup = { id: string; scope: string; at: string; reason: string; state: State; order?: number; backupGroup?: string }
export type BackupView = Backup & { protected: boolean }
export type BackupProtection = { backupGroup?: string } | null
export const isConflictBackup = (reason: string) => reason === 'sync-conflict-local' || reason === 'sync-conflict-cloud'
export const stateContentKey = (state: State) => semanticKey({ ...dataOf(state), settings: state.settings })
export const isBackupProtected = (backup: Backup, conflict: BackupProtection) => Boolean(conflict && (conflict.backupGroup ? backup.backupGroup === conflict.backupGroup : isConflictBackup(backup.reason)))
export const compareBackups = (a: Backup, b: Backup) => (b.order ?? 0) - (a.order ?? 0) || b.at.localeCompare(a.at) || b.id.localeCompare(a.id)

// Operates only on copies for one owner; the repository commits the result along
// with the finance state. Unresolved conflict copies are exempt from retention.
export function retainBackups(existing: Backup[], requested: Backup[], conflict: BackupProtection): Backup[] {
  let entries = existing.map(backup => ({ ...backup }))
  for (const incoming of requested) {
    const key = stateContentKey(incoming.state)
    const equivalent = entries.find(backup => {
      if (isBackupProtected(backup, conflict) || isBackupProtected(incoming, conflict)) {
        if (backup.backupGroup !== incoming.backupGroup || backup.reason !== incoming.reason) return false
      }
      return stateContentKey(backup.state) === key
    })
    if (equivalent) entries = entries.map(backup => backup.id === equivalent.id ? { ...incoming, id: equivalent.id } : backup)
    else entries.push(incoming)
  }
  const seen = new Set(entries.filter(backup => isBackupProtected(backup, conflict)).map(backup => stateContentKey(backup.state)))
  let normalCount = 0
  return entries.sort(compareBackups).filter(backup => {
    if (isBackupProtected(backup, conflict)) return true
    const key = stateContentKey(backup.state)
    if (seen.has(key) || normalCount >= NORMAL_BACKUP_LIMIT) return false
    seen.add(key); normalCount++; return true
  })
}
