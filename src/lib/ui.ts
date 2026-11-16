import { useSyncExternalStore } from 'react'

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

export type ToastTone = 'default' | 'success' | 'error'
export type ToastItem = { id: number; message: string; tone: ToastTone }

type ConfirmState = {
  options: ConfirmOptions
  resolve: (v: boolean) => void
} | null
export type ImportDialogOptions = { json: string; scope: string; generation: number; title: string; source?: 'guest' }
type ImportState = { id: number; options: ImportDialogOptions; resolve: (value: boolean) => void } | null

let confirmState: ConfirmState = null
let importState: ImportState = null
let toasts: ToastItem[] = []
let nextId = 1

type Snapshot = { confirm: ConfirmState; importing: ImportState; toasts: ToastItem[] }
let snapshot: Snapshot = { confirm: null, importing: null, toasts: [] }

const listeners = new Set<() => void>()
function emit() {
  snapshot = { confirm: confirmState, importing: importState, toasts }
  listeners.forEach((l) => l())
}

export function useUI(): Snapshot {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => snapshot,
  )
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (confirmState) {
    const prev = confirmState.resolve
    confirmState = null
    prev(false)
  }
  return new Promise((resolve) => {
    confirmState = { options, resolve }
    emit()
  })
}

export function resolveConfirm(value: boolean) {
  if (!confirmState) return
  const resolve = confirmState.resolve
  confirmState = null
  emit()
  resolve(value)
}
export function importDialog(options: ImportDialogOptions): Promise<boolean> {
  resolveImport(false); resolveConfirm(false)
  return new Promise(resolve => { importState = { id: nextId++, options, resolve }; emit() })
}
export function resolveImport(value: boolean, id?: number) {
  if (!importState || id !== undefined && importState.id !== id) return
  const resolve = importState.resolve; importState = null; emit(); resolve(value)
}

export function toast(message: string, tone: ToastTone = 'default', duration = 2600) {
  const id = nextId++
  toasts = [...toasts, { id, message, tone }]
  emit()
  if (duration > 0) window.setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function clearUI(): void {
  resolveConfirm(false)
  resolveImport(false)
  toasts = []; emit()
}

// Forms close and success toasts run only after the durable action resolves.
export async function perform<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try { return await operation() }
  catch (error) { toast(error instanceof Error ? error.message : 'Operasi gagal. Data belum disimpan.', 'error', 6000); return undefined }
}
