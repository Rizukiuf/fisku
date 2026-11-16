import { entityKeys, isUuid, requireValue } from './model'
import type { ImportIds } from './imports'

export type MergeAliases = ImportIds
export const emptyAliases = (): MergeAliases => ({ accounts: {}, categories: {}, transactions: {}, budgets: {} })
export function checkMergeAliases(value: unknown): asserts value is MergeAliases | undefined {
  if (value === undefined) return
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Pemetaan merge tidak valid.')
  const aliases = value as MergeAliases
  requireValue(Object.keys(aliases).length === entityKeys.length && entityKeys.every(key => Object.hasOwn(aliases, key)), 'Pemetaan merge tidak lengkap.')
  for (const key of entityKeys) {
    const map = aliases[key]
    requireValue(map && typeof map === 'object' && !Array.isArray(map), 'Pemetaan merge tidak valid.')
    requireValue(Object.entries(map).every(([source, target]) => isUuid(source) && isUuid(target) && source === source.toLowerCase() && target === target.toLowerCase()), 'Identitas merge tidak valid.')
  }
}
