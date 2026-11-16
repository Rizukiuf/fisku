import { decodeState, entityKeys, now, uid, type Account, type Budget, type EntityKey, type State, type Syncable } from './model'
import { emptyAliases } from './importAliases'
import { same } from './reconcile'
import { mergeTransactions } from './mergeTransactions'
import type { ImportIds } from './imports'
import type { Workspace } from './repository'
import type { EntityMapping, EntityTargets, MergeChoices, MergePlan, ValueConflict } from './mergeTypes'

const normalized = (name: string) => name.trim().toLowerCase()
export function allocateMergeIds(current: State, imported: State): ImportIds {
  const ids = emptyAliases()
  for (const key of entityKeys) {
    const used = new Set([...current[key].map(row => row.id), ...current.purged[key], ...imported[key].map(row => row.id), ...imported.purged[key]])
    for (const row of imported[key]) { let id: string; do { id = uid() } while (used.has(id)); ids[key][row.id] = id; used.add(id) }
  }
  return ids
}

export function buildMergePlan(workspace: Workspace, imported: State, choices: MergeChoices, allocations: ImportIds): MergePlan {
  const current = workspace.state; const next = structuredClone(current); const at = now()
  const aliases = structuredClone(workspace.mergeIds ?? emptyAliases())
  const targets: EntityTargets = { accounts: {}, categories: {} }
  const mappings: EntityMapping[] = []; const values: ValueConflict[] = []; const errors: string[] = []
  const setAlias = (kind: EntityKey, source: string, target: string) => { if (source !== target) aliases[kind][source] = target; else delete aliases[kind][source] }
  for (const kind of ['accounts', 'categories'] as const) {
    const active = current[kind].filter(row => !row.deletedAt)
    const all = new Map(current[kind].map(row => [row.id, row]))
    const removed = new Set(current.purged[kind])
    for (const source of imported[kind].filter(row => !row.deletedAt)) {
      const key = `${kind}:${source.id}`
      const compatible = (row: typeof source) => row.type === source.type && normalized(row.name) === normalized(source.name)
      const priorId = aliases[kind][source.id] ?? workspace.importIds?.[kind][source.id]
      const prior = active.find(row => row.id === priorId && compatible(row))
      const exact = active.find(row => row.id === source.id)
      const named = active.filter(compatible)
      const deleted = removed.has(source.id) || Boolean(all.get(source.id)?.deletedAt)
      const nameCollision = kind === 'accounts' && active.some(row => normalized(row.name) === normalized(source.name) && row.type !== source.type)
      let reason: EntityMapping['reason'] = deleted && !prior ? 'deleted' : exact && !compatible(exact) && !prior || nameCollision ? 'identity' : named.length > 1 ? 'ambiguous' : null
      const suggested = prior?.id ?? (exact && compatible(exact) ? exact.id : named.length === 1 ? named[0].id : 'new')
      let selected = choices.entities?.[key] ?? (reason && !(reason === 'deleted' && choices.recoverDeleted) ? '' : suggested)
      const row: EntityMapping = { key, kind, source, selected, name: choices.names?.[key] ?? source.name, required: !selected, reason }
      mappings.push(row)
      if (!selected) { targets[kind][source.id] = undefined; continue }
      if (selected === 'skip') { targets[kind][source.id] = null; continue }
      if (selected !== 'new') {
        const destination = active.find(item => item.id === selected)
        if (!destination || kind === 'categories' && destination.type !== source.type) {
          row.required = true; row.reason = 'invalid'; targets[kind][source.id] = undefined; continue
        }
        row.target = destination.id; targets[kind][source.id] = destination.id; setAlias(kind, source.id, destination.id)
        continue
      }
      const id = all.has(source.id) || removed.has(source.id) ? allocations[kind][source.id] : source.id
      const created = { ...source, id, name: row.name.trim(), updatedAt: at, deletedAt: null }
      ;(next[kind] as Syncable[]).push(created)
      row.target = id; targets[kind][source.id] = id; setAlias(kind, source.id, id)
    }
  }
  const pickValue = (value: ValueConflict, auto: string) => {
    value.selected = choices.values?.[value.key] ?? auto
    if (value.selected === 'local' && value.current !== undefined) { values.push(value); return null }
    const source = value.sources.find(item => `source:${item.id}` === value.selected)
    if (!source) value.required = true
    values.push(value); return source
  }
  const accountGroups = new Map<string, Account[]>()
  for (const source of imported.accounts.filter(row => !row.deletedAt)) {
    const id = targets.accounts[source.id]; if (!id) continue
    accountGroups.set(id, [...(accountGroups.get(id) ?? []), source])
  }
  for (const [id, sources] of accountGroups) {
    const local = current.accounts.find(row => row.id === id && !row.deletedAt)
    if (!local) continue
    const conflict = sources.some(row => row.initialBalance !== local.initialBalance)
    if (!conflict) continue
    const value: ValueConflict = { key: `balance:${id}`, kind: 'balance', name: local.name, current: local.initialBalance, sources: sources.map(row => ({ id: row.id, name: row.name, value: row.initialBalance })), selected: '', required: false, deleted: false }
    const chosen = pickValue(value, '')
    if (chosen) Object.assign(next.accounts.find(row => row.id === id)!, { initialBalance: chosen.value, updatedAt: at })
  }
  const budgetGroups = new Map<string, Budget[]>()
  for (const source of imported.budgets.filter(row => !row.deletedAt)) {
    const categoryId = targets.categories[source.categoryId]; if (!categoryId) continue
    budgetGroups.set(categoryId, [...(budgetGroups.get(categoryId) ?? []), source])
  }
  for (const [categoryId, sources] of budgetGroups) {
    const local = current.budgets.find(row => row.categoryId === categoryId)
    const category = next.categories.find(row => row.id === categoryId)!
    const deletedSource = sources.some(row => (current.purged.budgets.includes(row.id) || current.budgets.some(old => old.id === row.id && old.deletedAt)) && !(local && !local.deletedAt && (aliases.budgets[row.id] ?? workspace.importIds?.budgets[row.id]) === local.id))
    const conflict = local ? Boolean(local.deletedAt) || sources.some(row => row.limit !== local.limit) : new Set(sources.map(row => row.limit)).size > 1
    const requiresChoice = conflict || deletedSource && !choices.recoverDeleted
    let selected = local && !local.deletedAt && !conflict ? 'local' : `source:${sources[0].id}`
    if (requiresChoice && !(local?.deletedAt && choices.recoverDeleted && sources.length === 1)) selected = ''
    const value: ValueConflict = { key: `budget:${categoryId}`, kind: 'budget', name: category.name, current: local?.limit, sources: sources.map(row => ({ id: row.id, name: category.name, value: row.limit })), selected: '', required: false, deleted: Boolean(local?.deletedAt) || deletedSource }
    const chosen = pickValue(value, selected)
    if (!value.required && (chosen || local)) {
      let id = local?.id
      if (chosen) {
        const source = sources.find(row => row.id === chosen.id)!
        id ??= current.budgets.some(row => row.id === source.id) || current.purged.budgets.includes(source.id) ? allocations.budgets[source.id] : source.id
        if (local) Object.assign(next.budgets.find(row => row.id === id)!, { limit: chosen.value, deletedAt: null, updatedAt: at })
        else next.budgets.push({ ...source, id, categoryId, limit: chosen.value, deletedAt: null, updatedAt: at })
      }
      if (id) for (const source of sources) setAlias('budgets', source.id, id)
    }
  }
  const transactions = mergeTransactions(next, current, imported, choices, targets, allocations, aliases, workspace.importIds, at)
  const unresolved = mappings.filter(row => row.required).length + values.filter(row => row.required).length + transactions.filter(row => row.required).length
  try { decodeState(next) } catch (error) { errors.push(error instanceof Error ? error.message : 'Hasil merge tidak valid.') }
  const counts = Object.fromEntries(entityKeys.map(key => {
    const previous = new Map(current[key].map(row => [row.id, row])); const after = next[key].filter(row => !row.deletedAt)
    return [key, { before: current[key].filter(row => !row.deletedAt).length, after: after.length, added: after.filter(row => !previous.has(row.id)).length, updated: after.filter(row => previous.has(row.id) && !same(previous.get(row.id), row)).length }]
  })) as MergePlan['counts']
  return {
    state: next, aliases: workspace.mergeIds || entityKeys.some(key => Object.keys(aliases[key]).length) ? aliases : undefined,
    mappings, values, transactions, unresolved, errors, counts,
    ignoredDeleted: entityKeys.reduce((sum, key) => sum + imported[key].filter(row => row.deletedAt).length, 0),
    ignoredPurged: entityKeys.reduce((sum, key) => sum + imported.purged[key].length, 0),
  }
}
