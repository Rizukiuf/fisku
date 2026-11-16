export const formatIDR = (value: number, locale = 'id-ID') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)

export const formatNumber = (value: number, locale = 'id-ID') =>
  new Intl.NumberFormat(locale).format(value)

export const parseAmount = (raw: string) => {
  const value = raw.trim()
  if (!value) return 0
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+)$/.test(value)) throw new Error('Gunakan nominal rupiah bulat; angka desimal atau format ini tidak didukung.')
  const number = Number(value.replace(/[.,]/g, ''))
  if (!Number.isSafeInteger(number)) throw new Error('Nominal melampaui batas aman.')
  return number
}

type AmountEdit = { previous: string; inputType?: string; data?: string | null }

export function formatAmountInput(raw: string, edit?: AmountEdit): string {
  if (raw === '' || raw === '-') return raw
  try { return formatNumber(parseAmount(raw)) } catch { /* A digit edit can temporarily break the old grouping. */ }
  const isDigitEdit = edit?.inputType === 'insertText' && /^\d+$/.test(edit.data ?? '')
  const isDeletion = edit?.inputType?.startsWith('delete')
  if (!edit || (!isDigitEdit && !isDeletion) || !/^-?[\d.]+$/.test(raw)) return raw
  try {
    // Only regroup separators that the formatter supplied previously. Keep
    // malformed pasted values and manually entered decimals visible for validation.
    if (formatNumber(parseAmount(edit.previous)) !== edit.previous) return raw
    const digits = raw.replace(/\./g, '')
    if (digits === '' || digits === '-') return digits
    const amount = Number(digits)
    return Number.isSafeInteger(amount) ? formatNumber(amount) : raw
  } catch { return raw }
}

export function amountCaretPosition(raw: string, formatted: string, position: number): number {
  if (position <= 0) return 0
  if (position >= raw.length) return formatted.length
  const digits = raw.slice(0, position).replace(/\D/g, '').length
  if (!digits) return formatted.startsWith('-') ? 1 : 0
  let seen = 0
  for (let index = 0; index < formatted.length; index++) {
    if (/\d/.test(formatted[index]) && ++seen === digits) return index + 1
  }
  return formatted.length
}

export const formatDate = (iso: string, locale = 'id-ID') => {
  const d = /^\d{4}-\d\d-\d\d$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

// Menggunakan tanggal LOKAL (bukan UTC) agar transaksi
// yang dibuat pukul 00:00–07:00 WIB tidak "mundur" sehari.
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
