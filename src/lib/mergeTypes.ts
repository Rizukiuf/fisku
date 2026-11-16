import type { Account, Category, EntityKey, State, Transaction } from './model'
import type { ImportIds } from './imports'
import type { MergeAliases } from './importAliases'
import type { Workspace } from './repository'

export type ImportMode = 'merge' | 'replace'
export type MergeChoices = {
  entities?: Record<string, string>; names?: Record<string, string>
  values?: Record<string, string>; transactions?: Record<string, string>; recoverDeleted?: boolean
}
export type EntityTargets = { accounts: Record<string, string | null | undefined>; categories: Record<string, string | null | undefined> }
export type EntityMapping = {
  key: string; kind: 'accounts' | 'categories'; source: Account | Category
  selected: string; target?: string; name: string; required: boolean
  reason: 'deleted' | 'identity' | 'invalid' | 'ambiguous' | null
}
export type ValueConflict = {
  key: string; kind: 'balance' | 'budget'; name: string; current?: number
  sources: { id: string; name: string; value: number }[]; selected: string; required: boolean; deleted: boolean
}
export type TransactionReview = {
  source: Transaction; mapped?: Transaction; local?: Transaction; candidates: Transaction[]
  kind: 'new' | 'identical' | 'conflict' | 'possible' | 'deleted' | 'transfer' | 'dependent'
  selected: string; required: boolean; skipped: boolean
}
export type MergePlan = {
  state: State; aliases?: MergeAliases; mappings: EntityMapping[]; values: ValueConflict[]; transactions: TransactionReview[]
  unresolved: number; errors: string[]; ignoredDeleted: number; ignoredPurged: number
  counts: Record<EntityKey, { before: number; after: number; added: number; updated: number }>
}
export type ImportReview = {
  scope: string; generation: number; workspace: Workspace; imported: State; allocations: ImportIds; purgedRows: number
  replacement?: { state: State; ids?: ImportIds }; replaceError?: string
  guestFingerprint?: string
}
