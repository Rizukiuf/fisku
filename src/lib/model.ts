export type AccountType = 'cash' | 'bank' | 'ewallet' | 'credit'
export type TxType = 'income' | 'expense' | 'transfer'
export type Syncable = { id: string; updatedAt: string; deletedAt: string | null }
export type Account = Syncable & { name: string; type: AccountType; initialBalance: number }
export type Category = Syncable & { name: string; type: TxType }
export type Transaction = Syncable & {
  accountId: string; categoryId?: string; targetAccountId?: string
  type: TxType; amount: number; date: string; note?: string
}
export type Budget = Syncable & { categoryId: string; limit: number }
export type Settings = { theme: 'light' | 'dark' | 'system'; lang: 'id' | 'en' }
export const entityKeys = ['accounts', 'categories', 'transactions', 'budgets'] as const
export type EntityKey = typeof entityKeys[number]
export type Purged = Record<EntityKey, string[]>
export type Data = { accounts: Account[]; categories: Category[]; transactions: Transaction[]; budgets: Budget[]; purged: Purged }
export type State = Data & { settings: Settings }
export const uid = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export const now = () => new Date().toISOString()
export const emptyPurged = (): Purged => ({ accounts: [], categories: [], transactions: [], budgets: [] })
export const emptyData = (): Data => ({ accounts: [], categories: [], transactions: [], budgets: [], purged: emptyPurged() })
export const defaults: Settings = { theme: 'system', lang: 'id' }
export const emptyState = (): State => ({ ...emptyData(), settings: { ...defaults } })
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
export function isUuid(value: unknown): value is string { return typeof value === 'string' && uuidPattern.test(value) }
export function money(value: unknown, label: string, minimum = 0): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum, `${label}: gunakan bilangan rupiah bulat dalam batas aman.`)
  return value
}
export function safeSum(values: number[]): number {
  // BigInt checks the result without losing precision, even when intermediate sums overflow.
  const result = values.reduce((total, value) => total + BigInt(value), 0n)
  requireValue(result <= BigInt(Number.MAX_SAFE_INTEGER) && result >= BigInt(Number.MIN_SAFE_INTEGER), 'Total nominal melampaui batas aman.')
  return Number(result)
}
function record(value: unknown, label: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} tidak valid.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max = 200): string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label} tidak valid (maksimal ${max} karakter).`)
  return value.trim()
}
function timestamp(value: unknown): string {
  requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)), 'Timestamp tidak valid.')
  return new Date(value).toISOString()
}
function stamp(row: Record<string, unknown>): Syncable {
  requireValue(isUuid(row.id), 'ID data harus berupa UUID.')
  return { id: row.id.toLowerCase(), updatedAt: timestamp(row.updatedAt), deletedAt: row.deletedAt == null ? null : timestamp(row.deletedAt) }
}
export function canonicalTransaction(row: Transaction): Transaction {
  return { ...row, categoryId: row.type === 'transfer' ? undefined : row.categoryId, targetAccountId: row.type === 'transfer' ? row.targetAccountId : undefined }
}
export function decodeState(input: unknown): State {
  const raw = record(input, 'Data')
  const arrays = (key: EntityKey) => {
    requireValue(Array.isArray(raw[key]), `Daftar ${key} tidak valid.`)
    return (raw[key] as unknown[]).map(value => record(value, key))
  }
  const accounts: Account[] = arrays('accounts').map(row => {
    requireValue(['cash', 'bank', 'ewallet', 'credit'].includes(String(row.type)), 'Jenis akun tidak valid.')
    return { ...stamp(row), name: text(row.name, 'Nama akun'), type: row.type as AccountType, initialBalance: money(row.initialBalance, 'Saldo awal', Number.MIN_SAFE_INTEGER) }
  })
  const categories: Category[] = arrays('categories').map(row => {
    requireValue(row.type === 'income' || row.type === 'expense', 'Kategori harus pemasukan atau pengeluaran.')
    return { ...stamp(row), name: text(row.name, 'Nama kategori'), type: row.type }
  })
  const transactions: Transaction[] = arrays('transactions').map(row => {
    requireValue(['income', 'expense', 'transfer'].includes(String(row.type)), 'Jenis transaksi tidak valid.')
    requireValue(isUuid(row.accountId), 'ID akun transaksi tidak valid.')
    requireValue(typeof row.date === 'string' && /^[0-9]{4}-\d\d-\d\d$/.test(row.date) && row.date >= '0001-01-01' && new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) === row.date, 'Tanggal transaksi tidak valid.')
    requireValue(row.note == null || (typeof row.note === 'string' && row.note.length <= 2000), 'Catatan maksimal 2000 karakter.')
    requireValue(row.categoryId == null || isUuid(row.categoryId), 'ID kategori tidak valid.')
    requireValue(row.targetAccountId == null || isUuid(row.targetAccountId), 'ID akun tujuan tidak valid.')
    // Reject malformed external records rather than concealing stale references.
    requireValue(row.type === 'transfer' ? row.categoryId == null : row.targetAccountId == null, 'Referensi transaksi tidak sesuai jenisnya.')
    return { ...stamp(row), accountId: row.accountId.toLowerCase(), categoryId: (row.categoryId as string | undefined)?.toLowerCase(), targetAccountId: (row.targetAccountId as string | undefined)?.toLowerCase(), type: row.type as TxType, amount: money(row.amount, 'Nominal transaksi', 1), date: row.date, note: row.note == null ? undefined : row.note as string }
  })
  const budgets: Budget[] = arrays('budgets').map(row => {
    requireValue(isUuid(row.categoryId), 'ID kategori anggaran tidak valid.')
    const base = stamp(row)
    return { ...base, categoryId: row.categoryId.toLowerCase(), limit: money(row.limit, 'Batas anggaran', base.deletedAt ? 0 : 1) }
  })
  const settings = raw.settings == null ? { ...defaults } : record(raw.settings, 'Preferensi')
  requireValue(['light', 'dark', 'system'].includes(String(settings.theme)) && ['id', 'en'].includes(String(settings.lang)), 'Preferensi tidak valid.')
  const purged = emptyPurged()
  if (raw.purged !== undefined) {
    const graves = record(raw.purged, 'Penanda penghapusan')
    for (const key of entityKeys) {
      requireValue(Array.isArray(graves[key]) && (graves[key] as unknown[]).every(isUuid), 'Penanda penghapusan tidak valid.')
      purged[key] = [...new Set((graves[key] as string[]).map(id => id.toLowerCase()))].sort()
    }
  }
  const state: State = { accounts, categories, transactions, budgets, purged, settings: settings as Settings }
  validateRelations(state)
  return state
}
export function validateRelations(state: State): void {
  for (const key of entityKeys) {
    const rows = state[key]
    const removed = new Set(state.purged[key])
    requireValue(new Set(rows.map(row => row.id)).size === rows.length, `ID ${key} duplikat.`)
    requireValue(!rows.some(row => removed.has(row.id)), 'Data yang dimusnahkan tidak boleh dihidupkan kembali dengan ID yang sama.')
  }
  const unique = (keys: string[], label: string) => requireValue(new Set(keys).size === keys.length, `${label} duplikat; tentukan pemetaan data terlebih dahulu.`)
  unique(state.accounts.filter(a => !a.deletedAt).map(a => a.name.trim().toLowerCase()), 'Nama akun')
  unique(state.categories.filter(c => !c.deletedAt).map(c => `${c.type}|${c.name.trim().toLowerCase()}`), 'Nama kategori')
  unique(state.budgets.map(b => b.categoryId), 'Anggaran kategori')
  const accounts = new Map(state.accounts.map(a => [a.id, a]))
  const categories = new Map(state.categories.map(c => [c.id, c]))
  for (const tx of state.transactions) {
    const account = accounts.get(tx.accountId)
    const target = tx.targetAccountId ? accounts.get(tx.targetAccountId) : undefined
    const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
    requireValue(account && (tx.deletedAt || !account.deletedAt), 'Akun transaksi tidak tersedia; pulihkan akun terlebih dahulu.')
    if (tx.type === 'transfer') {
      requireValue(target && target.id !== tx.accountId && (tx.deletedAt || !target.deletedAt), 'Akun tujuan transfer harus tersedia dan berbeda.')
    } else {
      requireValue(category && category.type === tx.type && (tx.deletedAt || !category.deletedAt), 'Kategori transaksi tidak tersedia atau jenisnya tidak sesuai.')
    }
  }
  for (const budget of state.budgets) {
    const category = categories.get(budget.categoryId)
    requireValue(category && category.type === 'expense' && (budget.deletedAt || !category.deletedAt), 'Anggaran memerlukan kategori pengeluaran yang tersedia.')
  }
  for (const account of state.accounts) accountBalance(account, state.transactions)
  totalBalance(state.accounts, state.transactions)
  safeSum(state.transactions.filter(tx => !tx.deletedAt && tx.type === 'income').map(tx => tx.amount))
  safeSum(state.transactions.filter(tx => !tx.deletedAt && tx.type === 'expense').map(tx => tx.amount))
  safeSum(state.budgets.filter(b => !b.deletedAt).map(b => b.limit))
}
export function dataOf(state: State): Data {
  const { settings: _settings, ...data } = state
  const result = structuredClone(data)
  for (const key of entityKeys) result[key].sort((a, b) => a.id.localeCompare(b.id))
  return result
}
export function createSeed(fresh = false): State {
  const seedTime = '1970-01-01T00:00:00.000Z'
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
  const base = (index: number): Syncable => ({ id: fresh ? uid() : ids[index], updatedAt: fresh ? now() : seedTime, deletedAt: null })
  return { ...emptyData(), settings: { ...defaults }, accounts: [
    { ...base(0), name: 'Tunai', type: 'cash', initialBalance: 0 }, { ...base(1), name: 'BCA', type: 'bank', initialBalance: 0 }, { ...base(2), name: 'GoPay', type: 'ewallet', initialBalance: 0 },
  ], categories: ['Gaji', 'Bonus', 'Makan & Minum', 'Transportasi', 'Belanja', 'Tagihan', 'Hiburan'].map((name, i) => ({ ...base(i + 3), name, type: i < 2 ? 'income' : 'expense' })) }
}
export function accountBalance(account: Account, transactions: Transaction[]): number {
  return safeSum([account.initialBalance, ...transactions.filter(t => !t.deletedAt).flatMap(t => {
    if (t.type === 'income') return t.accountId === account.id ? [t.amount] : []
    if (t.type === 'expense') return t.accountId === account.id ? [-t.amount] : []
    return [t.accountId === account.id ? -t.amount : 0, t.targetAccountId === account.id ? t.amount : 0]
  })])
}
export function totalBalance(accounts: Account[], transactions: Transaction[]): number {
  return safeSum(accounts.filter(a => !a.deletedAt).map(a => accountBalance(a, transactions)))
}
export function monthKeyOf(date: string | Date): string {
  return typeof date === 'string' ? date.slice(0, 7) : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
export function monthlyStats(transactions: Transaction[], month = monthKeyOf(new Date())) {
  const rows = transactions.filter(t => !t.deletedAt && monthKeyOf(t.date) === month)
  return { income: safeSum(rows.filter(t => t.type === 'income').map(t => t.amount)), expense: safeSum(rows.filter(t => t.type === 'expense').map(t => t.amount)) }
}
export function budgetsForMonth(state: State, month = monthKeyOf(new Date())) {
  return state.categories.filter(c => c.type === 'expense' && !c.deletedAt).map(category => ({ category, limit: state.budgets.find(b => b.categoryId === category.id && !b.deletedAt)?.limit ?? 0, spent: safeSum(state.transactions.filter(t => !t.deletedAt && t.type === 'expense' && t.categoryId === category.id && monthKeyOf(t.date) === month).map(t => t.amount)) }))
}
export const activeAccounts = (state: State) => state.accounts.filter(a => !a.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
export const activeCategories = (state: State) => state.categories.filter(c => !c.deletedAt).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'expense' ? -1 : 1))
export const activeTransactions = (state: State) => state.transactions.filter(t => !t.deletedAt)
