import { entityKeys, now, type State } from './model'

// Keep tombstones, purge markers and preferences so a reset synchronizes safely.
export function resetToEmpty(current: State): { state: State; changed: boolean } {
  const next = structuredClone(current)
  const at = now()
  let changed = false
  for (const key of entityKeys) {
    for (const row of next[key]) if (!row.deletedAt) {
      row.deletedAt = at; row.updatedAt = at; changed = true
    }
  }
  return { state: next, changed }
}
