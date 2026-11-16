import { entityKeys, type Data, type EntityKey, type Syncable } from './model'
import { reconcileWithDetails, same } from './reconcile'

type Row = Syncable & { name?: string; type?: string; initialBalance?: number; amount?: number; date?: string; note?: string; accountId?: string; categoryId?: string; targetAccountId?: string; limit?: number }
export type ConflictValue = { kind: 'text' | 'money' | 'date' | 'time' | 'status' | 'accountType' | 'txType'; value: string | number | null }
export type ConflictField = 'name' | 'type' | 'initialBalance' | 'amount' | 'date' | 'note' | 'accountId' | 'categoryId' | 'targetAccountId' | 'limit' | 'deletedAt' | 'status'
export type ConflictItem = { key: string; kind: EntityKey; id: string; name: string; fields: { field: ConflictField; local: ConflictValue; remote: ConflictValue }[] }
const fields: Record<EntityKey, Exclude<ConflictField, 'status'>[]> = {
  accounts: ['name', 'type', 'initialBalance', 'deletedAt'],
  categories: ['name', 'type', 'deletedAt'],
  transactions: ['type', 'amount', 'date', 'accountId', 'categoryId', 'targetAccountId', 'note', 'deletedAt'],
  budgets: ['categoryId', 'limit', 'deletedAt'],
}
function index(data: Data) {
  return Object.fromEntries(entityKeys.map(kind => [kind, { rows: new Map<string, Row>(data[kind].map(row => [row.id, row])), purged: new Set(data.purged[kind]) }])) as Record<EntityKey, { rows: Map<string, Row>; purged: Set<string> }>
}
type Index = ReturnType<typeof index>
function status(data: Index, kind: EntityKey, id: string): string {
  return data[kind].purged.has(id) ? 'purged' : !data[kind].rows.has(id) ? 'missing' : data[kind].rows.get(id)!.deletedAt ? 'deleted' : 'active'
}
function value(data: Index, kind: EntityKey, row: Row | undefined, field: Exclude<ConflictField, 'status'>): ConflictValue {
  const raw = row?.[field] ?? null
  if (field === 'initialBalance' || field === 'amount' || field === 'limit') return { kind: 'money', value: raw }
  if (field === 'date') return { kind: 'date', value: raw }
  if (field === 'deletedAt') return { kind: 'time', value: raw }
  if (field === 'type') return { kind: kind === 'accounts' ? 'accountType' : 'txType', value: raw }
  if (field === 'accountId' || field === 'targetAccountId' || field === 'categoryId') {
    const target = field === 'categoryId' ? 'categories' : 'accounts'
    return { kind: 'text', value: typeof raw === 'string' ? data[target].rows.get(raw)?.name ?? raw : null }
  }
  return { kind: 'text', value: raw }
}

// Reuse the actual resolver for both choices: saved identities can become stale,
// and even an ordinary row conflict can trigger a complete-dataset fallback.
export function buildConflictDetails(local: Data, remote: Data, savedIds: string[], base: Data): { wholeDataset: boolean; items: ConflictItem[]; ids: string[] } {
  const here = index(local); const there = index(remote)
  const remoteChoice = reconcileWithDetails(base, local, remote, 'remote')
  let localChoice: ReturnType<typeof reconcileWithDetails> | undefined
  try { localChoice = reconcileWithDetails(base, local, remote, 'local') }
  catch { /* Local may be unavailable when the cloud has permanently removed an ID. */ }
  const ids = [...new Set([...remoteChoice.conflictIds, ...localChoice?.conflictIds ?? [], ...savedIds])]
  const parsed = ids.map(id => /^(accounts|categories|transactions|budgets)\/([0-9a-f-]{36})(?:\s|$)/i.exec(id))
  const wholeDataset = remoteChoice.wholeDataset || Boolean(localChoice?.wholeDataset) || parsed.some(match => !match)
  const keys = wholeDataset
    ? entityKeys.flatMap(kind => [...new Set([...here[kind].rows.keys(), ...there[kind].rows.keys(), ...here[kind].purged, ...there[kind].purged])].sort().map(id => `${kind}/${id}`))
    : parsed.map(match => `${match![1]}/${match![2]}`)
  const items: ConflictItem[] = []
  for (const key of new Set(keys)) {
    const [kind, id] = key.split('/') as [EntityKey, string]
    const left = here[kind].rows.get(id); const right = there[kind].rows.get(id)
    const leftStatus = status(here, kind, id); const rightStatus = status(there, kind, id)
    if (wholeDataset && same(left, right) && leftStatus === rightStatus) continue
    const differences: ConflictItem['fields'] = []
    if (leftStatus !== rightStatus) differences.push({ field: 'status', local: { kind: 'status', value: leftStatus }, remote: { kind: 'status', value: rightStatus } })
    for (const field of fields[kind]) {
      if (same(left?.[field] ?? null, right?.[field] ?? null)) continue
      const localValue = value(here, kind, left, field); const remoteValue = value(there, kind, right, field)
      // Two different references can have the same visible name across snapshots.
      if ((field === 'accountId' || field === 'targetAccountId' || field === 'categoryId') && localValue.value === remoteValue.value) {
        localValue.value = `${localValue.value} (${left?.[field]})`; remoteValue.value = `${remoteValue.value} (${right?.[field]})`
      }
      differences.push({ field, local: localValue, remote: remoteValue })
    }
    const row = left ?? right; const source = left ? here : there
    const name = row?.name ?? (kind === 'budgets' ? source.categories.rows.get(row?.categoryId ?? '')?.name : kind === 'transactions' ? `${row?.date ?? ''} · ${source.accounts.rows.get(row?.accountId ?? '')?.name ?? row?.accountId ?? id}` : undefined) ?? id
    items.push({ key, kind, id, name, fields: differences })
  }
  return { wholeDataset, items, ids }
}
