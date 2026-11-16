export type SyncDeadline = {
  signal: AbortSignal
  check(): void
  step<T>(label: string, operation: () => PromiseLike<T>): Promise<T>
}

export class SyncTimeoutError extends Error {
  readonly code = 'SYNC_TIMEOUT'
  constructor(stage: string) {
    super(`Sinkronisasi terlalu lama saat ${stage}. Perubahan lokal dan antrean tetap disimpan. Coba lagi; jika berulang, muat ulang aplikasi.`)
    this.name = 'SyncTimeoutError'
  }
}

export async function withSyncDeadline<T>(operation: (deadline: SyncDeadline) => Promise<T>, { totalMs = 30000, stepMs = 15000, onStage }: { totalMs?: number; stepMs?: number; onStage?: (label: string) => void } = {}): Promise<T> {
  const controller = new AbortController()
  let stage = 'menyiapkan sinkronisasi'
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  const totalTimer = setTimeout(() => controller.abort(new SyncTimeoutError(stage)), totalMs)
  const deadline: SyncDeadline = {
    signal: controller.signal,
    check() { if (controller.signal.aborted) throw controller.signal.reason },
    async step(label, work) {
      deadline.check(); stage = label
      const stepTimer = setTimeout(() => controller.abort(new SyncTimeoutError(label)), stepMs)
      try {
        onStage?.(label)
        const value = await Promise.race([Promise.resolve().then(() => { deadline.check(); return work() }), aborted])
        deadline.check(); return value
      } finally { clearTimeout(stepTimer) }
    },
  }
  try { return await Promise.race([Promise.resolve().then(() => operation(deadline)), aborted]) }
  finally {
    clearTimeout(totalTimer)
    controller.abort(new Error('Percobaan sinkronisasi sudah selesai.'))
    controller.signal.removeEventListener('abort', onAbort)
  }
}
