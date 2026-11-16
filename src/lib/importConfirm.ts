import { importDialog } from './ui'
import type { useT } from './i18n'
import { actions, getGeneration, getScope } from './store'

export function confirmImport(json: string, scope: string, generation: number, t: ReturnType<typeof useT>, title = t('importData'), source?: 'guest') {
  return importDialog({ json, scope, generation, title, source })
}

export async function confirmGuestImport(t: ReturnType<typeof useT>) {
  const owner = getScope(); const generation = getGeneration()
  const prepared = await actions.inspectGuestImport(owner, generation)
  return confirmImport(prepared.json, owner, generation, t, t('importGuest'), 'guest')
}
