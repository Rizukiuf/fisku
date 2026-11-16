import { useFinance } from './store'
import { translations, translate, type Key, type Language } from './translations'
import { localizeMessage } from './messages'
export type { Key, Language } from './translations'

export function useT(language?: Language) {
  const state = useFinance()
  return (key: Key) => translate(key, language ?? state.settings.lang)
}

export function useMessage(language?: Language) {
  const state = useFinance()
  return (message: string) => localizeMessage(message, language ?? state.settings.lang)
}

export function useAccountTypeLabel() {
  const state = useFinance()
  const labels = translations[state.settings.lang].accountType as Record<string, string>
  return (type: string) => labels[type] ?? type
}

export function useLocale() {
  const state = useFinance()
  return state.settings.lang === 'id' ? 'id-ID' : 'en-US'
}
