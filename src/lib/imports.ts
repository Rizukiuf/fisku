import { decodeState, entityKeys, isUuid, now, requireValue, uid, type EntityKey, type State, type Syncable } from './model'

export type ImportIds = Record<EntityKey, Record<string, string>>
const emptyIds = (): ImportIds => ({ accounts: {}, categories: {}, transactions: {}, budgets: {} })
export function checkImportIds(value: unknown): asserts value is ImportIds | undefined {
  if (value === undefined) return
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Pemetaan pemulihan tidak valid.')
  const maps = value as ImportIds
  requireValue(Object.keys(maps).length === entityKeys.length && entityKeys.every(key => Object.hasOwn(maps, key)), 'Pemetaan pemulihan tidak lengkap.')
  for (const key of entityKeys) {
    const map = maps[key]
    requireValue(map && typeof map === 'object' && !Array.isArray(map), 'Pemetaan pemulihan tidak valid.')
    requireValue(Object.entries(map).every(([source, target]) => isUuid(source) && isUuid(target) && source === source.toLowerCase() && target === target.toLowerCase() && source !== target), 'Identitas pemulihan tidak valid.')
    requireValue(new Set(Object.values(map)).size === Object.keys(map).length, 'Identitas pemulihan duplikat.')
  }
}
export function parseImport(json: string): State {
  const raw = JSON.parse(json)
  requireValue(raw?.format === undefined || (raw.format === 'fisku-backup' && raw.version === 1), 'Versi backup tidak didukung.')
  return decodeState(raw?.format ? raw.data : raw)
}
export const purgedImportCount = (current: State, imported: State) => entityKeys.reduce((total, key) => {
  const purged = new Set(current.purged[key])
  return total + imported[key].filter(row => purged.has(row.id)).length
}, 0)

// Ordinary replace keeps identity and deletion history. Recovery is a separate,
// explicit operation; neither path resurrects a purged identity.
export function replaceState(next: State, imported: State) {
  const at = now()
  for (const key of entityKeys) {
    const removed = new Set(next.purged[key])
    requireValue(!imported[key].some(row => removed.has(row.id)), 'Backup memuat ID yang sudah dimusnahkan. Gunakan pilihan Pulihkan sebagai data baru pada impor cadangan.')
    const received = new Map<string, Syncable>((imported[key] as Syncable[]).map(row => [row.id, { ...row, updatedAt: at }]))
    const graves = new Set([...next.purged[key], ...imported.purged[key]])
    for (const row of next[key]) if (!received.has(row.id) && !graves.has(row.id)) received.set(row.id, { ...row, deletedAt: row.deletedAt ?? at, updatedAt: at })
    ;(next[key] as Syncable[]) = [...received.values()].filter(row => !graves.has(row.id))
    next.purged[key] = [...graves].sort()
  }
  next.settings = imported.settings
}

export function restoreImport(current: State, imported: State, previous?: ImportIds): { state: State; ids: ImportIds } {
  const attempt = (reuse: boolean) => {
    const ids = emptyIds()
    for (const key of entityKeys) {
      const sources = new Set(imported[key].map(row => row.id))
      const removed = new Set([...current.purged[key], ...imported.purged[key]])
      const reserved = new Set([...current[key].map(row => row.id), ...sources, ...removed, ...Object.values(previous?.[key] ?? {})])
      const used = new Set<string>()
      for (const row of [...imported[key]].sort((a, b) => a.id.localeCompare(b.id))) {
        let target = reuse ? previous?.[key][row.id] : undefined
        if (!target || removed.has(target) || sources.has(target) || used.has(target)) {
          do { target = uid() } while (reserved.has(target))
        }
        ids[key][row.id] = target; reserved.add(target); used.add(target)
      }
    }
    const mapped = structuredClone(imported)
    for (const key of entityKeys) for (const row of mapped[key]) row.id = ids[key][row.id]
    for (const row of mapped.transactions) {
      row.accountId = ids.accounts[row.accountId]
      if (row.targetAccountId) row.targetAccountId = ids.accounts[row.targetAccountId]
      if (row.categoryId) row.categoryId = ids.categories[row.categoryId]
    }
    for (const row of mapped.budgets) row.categoryId = ids.categories[row.categoryId]
    // These copies use a new namespace. The file's deletion markers must not
    // delete unrelated local identities; local markers remain unchanged.
    mapped.purged = structuredClone(current.purged)
    const next = structuredClone(current)
    replaceState(next, decodeState(mapped))
    return { state: decodeState(next), ids }
  }
  if (!previous) return attempt(false)
  try { return attempt(true) }
  catch {
    // Another backup may change category types while older trashed children still
    // reference the prior copy. Use a fresh graph when reuse violates relations.
    return attempt(false)
  }
}
