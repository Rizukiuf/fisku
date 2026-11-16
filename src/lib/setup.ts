import { createSeed, entityKeys, now, requireValue, uid, type State } from './model'

export const canApplyDefaultTemplate = (state: State) => entityKeys.every(key => state[key].every(row => row.deletedAt))

export function applyDefaultTemplate(current: State): State {
  requireValue(canApplyDefaultTemplate(current), 'Template hanya dapat ditambahkan saat tidak ada data keuangan aktif.')
  const next = structuredClone(current)
  const template = createSeed()
  const at = now()
  for (const account of template.accounts) {
    const unavailable = next.accounts.some(row => row.id === account.id) || next.purged.accounts.includes(account.id)
    next.accounts.push({ ...account, id: unavailable ? uid() : account.id, updatedAt: at })
  }
  for (const category of template.categories) {
    const unavailable = next.categories.some(row => row.id === category.id) || next.purged.categories.includes(category.id)
    next.categories.push({ ...category, id: unavailable ? uid() : category.id, updatedAt: at })
  }
  return next
}
