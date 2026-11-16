import { useEffect, useState } from 'react'
import { actions, getGeneration, getScope, getWorkspace, useFinance } from '../lib/store'

export function useGuestImport(enabled: boolean) {
  const state = useFinance(); const owner = getScope(); const generation = getGeneration()
  const receipt = getWorkspace()?.guestImport
  const [status, setStatus] = useState({ owner: '', generation: -1, available: false, fingerprint: null as string | null, error: null as string | null })
  useEffect(() => {
    let alive = true; let sequence = 0
    if (!enabled || !owner.startsWith('user:')) return
    const refresh = async () => {
      const current = ++sequence
      try {
        const result = await actions.guestImportStatus(owner, generation)
        if (alive && current === sequence) setStatus({ owner, generation, ...result, error: null })
      } catch (error) {
        if (alive && current === sequence) setStatus({ owner, generation, available: false, fingerprint: null, error: error instanceof Error ? error.message : 'Gagal memeriksa data tamu.' })
      }
    }
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fisku.local.changes') : null
    if (channel) channel.onmessage = event => { if (event.data?.scope === 'guest') void refresh() }
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus); void refresh()
    return () => { alive = false; channel?.close(); window.removeEventListener('focus', onFocus) }
  }, [enabled, owner, generation, state, receipt])
  return enabled && status.owner === owner && status.generation === generation ? status : { available: false, fingerprint: null, error: null }
}
