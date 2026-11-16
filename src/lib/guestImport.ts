import { dataOf, emptyPurged, entityKeys, requireValue, type State } from './model'
import { semanticKey } from './reconcile'

export function checkGuestReceipt(value: unknown): asserts value is string | undefined {
  requireValue(value === undefined || typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Status impor tamu tidak valid.')
}
export async function fingerprintGuest(state: State): Promise<string | null> {
  const data = dataOf(state)
  const active = {
    ...data,
    accounts: data.accounts.filter(row => !row.deletedAt), categories: data.categories.filter(row => !row.deletedAt),
    transactions: data.transactions.filter(row => !row.deletedAt), budgets: data.budgets.filter(row => !row.deletedAt),
    purged: emptyPurged(),
  }
  if (entityKeys.every(key => active[key].length === 0)) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semanticKey(active)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
