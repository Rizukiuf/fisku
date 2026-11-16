import { canonicalTransaction, type State, type Transaction } from './model'
import type { ImportIds } from './imports'
import type { MergeAliases } from './importAliases'
import type { EntityTargets, MergeChoices, TransactionReview } from './mergeTypes'

const signature = (row: Transaction) => JSON.stringify([row.type, row.amount, row.date, row.accountId, row.categoryId ?? '', row.targetAccountId ?? ''])
const equalContent = (a: Transaction, b: Transaction) => signature(a) === signature(b) && (a.note ?? '') === (b.note ?? '')

export function mergeTransactions(next: State, current: State, imported: State, choices: MergeChoices, targets: EntityTargets, ids: ImportIds, aliases: MergeAliases, prior: ImportIds | undefined, at: string): TransactionReview[] {
  const reviews: TransactionReview[] = []
  const currentById = new Map(current.transactions.map(row => [row.id, row]))
  const removed = new Set(current.purged.transactions)
  // A snapshot containing both IDs treats them as distinct records, including a
  // deleted source row. Keep the alias for later re-import of the original file.
  const sourceIds = new Set(imported.transactions.map(row => row.id))
  const setAlias = (source: string, target: string) => {
    if (source !== target) aliases.transactions[source] = target
    else {
      const priorAlias = aliases.transactions[source] ?? prior?.transactions[source]
      if (!priorAlias || !sourceIds.has(priorAlias)) delete aliases.transactions[source]
    }
  }
  const known = (row: Transaction) => {
    const alias = aliases.transactions[row.id] ?? prior?.transactions[row.id]
    const exact = currentById.get(row.id)?.deletedAt === null ? currentById.get(row.id) : undefined
    if (alias && alias !== row.id && sourceIds.has(alias)) return exact
    return (alias && currentById.get(alias)?.deletedAt === null ? currentById.get(alias) : undefined) ?? exact
  }
  const sourceRows = imported.transactions.filter(row => !row.deletedAt)
  // Resolve edits to known identities before comparing independent-source rows.
  const ordered = [...sourceRows.filter(known), ...sourceRows.filter(row => !known(row))]
  const updated = new Map<string, Transaction>()
  const explicitlyKept = new Set<string>()
  const originals = current.transactions.filter(row => !row.deletedAt)
  for (const source of ordered) {
    const selectedChoice = choices.transactions?.[source.id]
    const review: TransactionReview = { source, candidates: [], kind: 'new', selected: '', required: false, skipped: false }
    reviews.push(review)
    const account = targets.accounts[source.accountId]
    const category = source.categoryId ? targets.categories[source.categoryId] : undefined
    const target = source.targetAccountId ? targets.accounts[source.targetAccountId] : undefined
    if (!account || (source.type === 'transfer' ? !target : !category)) {
      review.kind = 'dependent'; review.skipped = true
      continue
    }
    const mapped = canonicalTransaction({ ...source, accountId: account, categoryId: category ?? undefined, targetAccountId: target ?? undefined, updatedAt: at, deletedAt: null })
    review.mapped = mapped
    if (selectedChoice === 'skip') { review.selected = 'skip'; review.skipped = true; continue }
    if (source.type === 'transfer' && account === target) {
      review.kind = 'transfer'; review.required = true; continue
    }
    const local = known(source)
    review.local = local
    if (local) {
      review.kind = equalContent(local, mapped) ? 'identical' : 'conflict'
      const selected = selectedChoice ?? (review.kind === 'identical' ? 'local' : '')
      review.selected = selected
      if (selected === 'local') {
        if (selectedChoice === 'local' && updated.has(local.id) && !equalContent(updated.get(local.id)!, local)) { review.required = true; review.kind = 'conflict'; continue }
        if (selectedChoice === 'local') explicitlyKept.add(local.id)
        review.skipped = true; setAlias(source.id, local.id); continue
      }
      if (selected === 'incoming') {
        if (explicitlyKept.has(local.id) && !equalContent(local, mapped)) { review.required = true; continue }
        const previousEdit = updated.get(local.id)
        if (previousEdit && !equalContent(previousEdit, mapped)) { review.required = true; continue }
        const row = { ...mapped, id: local.id }
        Object.assign(next.transactions.find(item => item.id === local.id)!, row)
        updated.set(local.id, row); setAlias(source.id, local.id); continue
      }
      if (selected !== 'copy' && selected !== 'add') { review.required = true; continue }
      const created = { ...mapped, id: ids.transactions[source.id] }
      next.transactions.push(created); setAlias(source.id, created.id); continue
    }
    const deleted = removed.has(source.id) || Boolean(currentById.get(source.id)?.deletedAt)
    review.kind = deleted ? 'deleted' : 'new'
    // Candidate comparison uses committed rows plus resolved edits, never earlier
    // new source rows: two identical purchases in one file retain multiplicity.
    review.candidates = originals.map(row => updated.get(row.id) ?? row).filter(row => signature(row) === signature(mapped))
    if (!deleted && review.candidates.length) review.kind = 'possible'
    const selected = selectedChoice ?? (review.candidates.length ? '' : deleted ? (choices.recoverDeleted ? 'add' : '') : 'add')
    review.selected = selected
    if (selected.startsWith('match:')) {
      const candidate = review.candidates.find(row => row.id === selected.slice(6))
      if (!candidate) { review.required = true; continue }
      setAlias(source.id, candidate.id); review.skipped = true; continue
    }
    if (selected !== 'add' && selected !== 'copy') { review.required = true; continue }
    const id = deleted || currentById.has(source.id) ? ids.transactions[source.id] : source.id
    next.transactions.push({ ...mapped, id }); setAlias(source.id, id)
  }
  return reviews
}
