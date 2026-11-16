import { decodeState, now, type EntityKey, type State, type Syncable } from './model'

export type RestoreAllResult = {
  restored: Record<EntityKey, number>
  skipped: Record<'account_missing' | 'category_missing' | 'target_account_missing' | 'invalid_limit' | 'name_conflict', number>
  changed: boolean
}

export function restoreDeleted(state: State, at = now()): RestoreAllResult & { state: State } {
  const next = structuredClone(state)
  const restored = { accounts: 0, categories: 0, transactions: 0, budgets: 0 }
  const skipped = { account_missing: 0, category_missing: 0, target_account_missing: 0, invalid_limit: 0, name_conflict: 0 }
  const restore = (row: Syncable, key: EntityKey) => {
    row.deletedAt = null; row.updatedAt = at; restored[key]++
  }
  for (const key of ['accounts', 'categories'] as const) {
    const names = next[key].map(row => `${key === 'categories' ? `${row.type}|` : ''}${row.name.trim().toLowerCase()}`)
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    for (const [index, row] of next[key].entries()) {
      if (!row.deletedAt) continue
      // Keep every ambiguous identity in trash rather than selecting by row order.
      if (counts.get(names[index])! > 1) { skipped.name_conflict++; continue }
      restore(row, key)
    }
  }
  const accounts = new Set(next.accounts.filter(row => !row.deletedAt).map(row => row.id))
  const categories = new Map(next.categories.filter(row => !row.deletedAt).map(row => [row.id, row.type]))
  for (const row of next.transactions) {
    if (!row.deletedAt) continue
    if (!accounts.has(row.accountId)) { skipped.account_missing++; continue }
    if (row.type === 'transfer') {
      if (!row.targetAccountId || !accounts.has(row.targetAccountId)) { skipped.target_account_missing++; continue }
    } else if (!row.categoryId || categories.get(row.categoryId) !== row.type) { skipped.category_missing++; continue }
    restore(row, 'transactions')
  }
  for (const row of next.budgets) {
    if (!row.deletedAt) continue
    if (categories.get(row.categoryId) !== 'expense') { skipped.category_missing++; continue }
    // A zero limit is a removed budget; restoring it requires a new positive limit.
    if (row.limit <= 0) { skipped.invalid_limit++; continue }
    restore(row, 'budgets')
  }
  // Restoring individually valid rows can overflow aggregates or duplicate names.
  // Validate the whole candidate before the caller commits any part of it.
  return { state: decodeState(next), restored, skipped, changed: Object.values(restored).some(count => count > 0) }
}
