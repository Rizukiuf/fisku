import type { ChangeEvent } from 'react'
import { amountCaretPosition, formatAmountInput } from './format'

export function handleAmountChange(event: ChangeEvent<HTMLInputElement>, previous: string, setValue: (value: string) => void): void {
  const input = event.currentTarget
  const native = event.nativeEvent as InputEvent
  const raw = input.value
  if (native.isComposing) { setValue(raw); return }
  const formatted = formatAmountInput(raw, { previous, inputType: native.inputType, data: native.data })
  const start = amountCaretPosition(raw, formatted, input.selectionStart ?? raw.length)
  const end = amountCaretPosition(raw, formatted, input.selectionEnd ?? raw.length)
  const direction = input.selectionDirection ?? 'none'
  // Apply formatting and its selection in the same input event. A delayed frame
  // can overwrite a newer selection or the next keystroke in a fast edit.
  if (raw !== formatted) input.value = formatted
  setValue(formatted)
  if (raw !== formatted) input.setSelectionRange(start, end, direction)
}
