import { dataOf, decodeState, defaults, emptyPurged, entityKeys, type Data, type Syncable } from './model'

export function semanticKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(semanticKey).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([key, entry]) => key !== 'updatedAt' && entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${semanticKey(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
export const same = (a: unknown, b: unknown): boolean => semanticKey(a) === semanticKey(b)
export class DataConflict extends Error {
  constructor(public readonly ids: string[]) { super(`Konflik perubahan (${ids.length}): ${ids.slice(0, 4).join(', ')}. Versi lokal dan cloud tetap tersimpan.`); this.name = 'DataConflict' }
}
// Three-way reconciliation uses the last acknowledged state, never device clocks.
// Non-conflicting edits merge automatically. Conflicting edits require an explicit choice.
export function reconcile(base: Data, local: Data, remote: Data, choice?: 'local' | 'remote'): Data {
  return reconcileWithDetails(base, local, remote, choice).data
}
export function reconcileWithDetails(base: Data, local: Data, remote: Data, choice?: 'local' | 'remote'): { data: Data; conflictIds: string[]; wholeDataset: boolean } {
  const result: Data = { accounts: [], categories: [], transactions: [], budgets: [], purged: emptyPurged() }
  const conflicts: string[] = []
  for (const key of entityKeys) {
    result.purged[key] = [...new Set([...local.purged[key], ...remote.purged[key]])].sort()
    const graves = new Set(result.purged[key])
    const maps = [base[key], local[key], remote[key]].map(rows => new Map<string, Syncable>(rows.map(row => [row.id, row])))
    for (const id of new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])) {
      const [before, here, there] = maps.map(map => map.get(id))
      if (graves.has(id)) {
        if (remote.purged[key].includes(id)) {
          if (here && !same(before, here)) {
            conflicts.push(`${key}/${id} (dimusnahkan di cloud)`)
            if (choice === 'local') throw new Error('ID ini sudah dimusnahkan di cloud. Ekspor cadangan lokal bila diperlukan, lalu gunakan versi cloud. Data hanya dapat dibuat ulang sebagai entitas baru.')
          }
          continue
        }
        if (there && !same(before, there)) {
          conflicts.push(`${key}/${id} (hapus lokal dan edit cloud)`)
          if (choice === 'remote') {
            result.purged[key] = result.purged[key].filter(value => value !== id)
            ;(result[key] as Syncable[]).push(structuredClone(there))
          }
        }
        continue
      }
      let selected: Syncable | undefined
      if (same(here, there) || same(before, there)) selected = here
      else if (same(before, here)) selected = there
      else {
        conflicts.push(`${key}/${id}`)
        selected = choice === 'remote' ? there : here
      }
      if (selected) (result[key] as Syncable[]).push(structuredClone(selected))
    }
    result[key].sort((a, b) => a.id.localeCompare(b.id))
  }
  if (conflicts.length && !choice) throw new DataConflict(conflicts)
  // Merged independent edits can violate cross-row rules (e.g. deleting a parent
  // while another device adds a child). Keep both complete snapshots in that case.
  try { return { data: dataOf(decodeState({ ...result, settings: defaults })), conflictIds: conflicts, wholeDataset: false } }
  catch (error) {
    if (!choice) throw new DataConflict([`relasi: ${error instanceof Error ? error.message : 'tidak valid'}`])
    // A relational conflict cannot be resolved row-by-row safely. The user selects
    // one complete dataset, with a durable backup of both versions before applying.
    const selected = structuredClone(choice === 'local' ? local : remote)
    if (choice === 'local') {
      for (const key of entityKeys) {
        // Choosing a complete local dataset explicitly removes cloud-only rows.
        // Account for those IDs, otherwise the backend correctly rejects omission.
        const retained = new Set(selected[key].map(row => row.id))
        selected.purged[key] = [...new Set([...selected.purged[key], ...remote.purged[key], ...remote[key].filter(row => !retained.has(row.id)).map(row => row.id)])].sort()
      }
    }
    return { data: dataOf(decodeState({ ...selected, settings: defaults })), conflictIds: conflicts, wholeDataset: true }
  }
}
