import { translations, type Language } from './translations'

// Domain messages remain stable for programmatic callers. Translate only at UI
// boundaries, without changing persisted finance data, error codes or provider diagnostics.
const messages: readonly (readonly [string, string])[] = [
  ['Sesi berubah atau penyimpanan belum siap. Coba lagi setelah pemuatan selesai.', 'The session changed or storage is not ready. Retry after loading finishes.'],
  ['Sesi berubah; operasi dibatalkan.', 'The session changed; the operation was cancelled.'],
  ['Data sudah tidak tersedia. Muat ulang daftar.', 'This item is no longer available. Reload the list.'],
  ['Data berubah di tab lain. Periksa versi terbaru sebelum menyimpan kembali.', 'Data changed in another tab. Review the latest version before saving again.'],
  ['Musnahkan transaksi terkait sebelum memusnahkan akun.', 'Permanently delete related transactions before permanently deleting the account.'],
  ['Musnahkan transaksi dan anggaran terkait sebelum memusnahkan kategori.', 'Permanently delete related transactions and budgets before permanently deleting the category.'],
  ['Anggaran berubah; muat ulang daftar.', 'The budget changed; reload the list.'],
  ['Atur ulang batas anggaran di halaman Anggaran.', 'Set the budget limit again on the Budgets page.'],
  ['Tunggu pemuatan data cloud selesai sebelum menggunakan template.', 'Wait for cloud data to finish loading before applying a template.'],
  ['Selesaikan konflik sinkronisasi sebelum menggunakan template.', 'Resolve the synchronization conflict before applying a template.'],
  ['Pilihan penyiapan awal tidak valid.', 'The initial setup choice is invalid.'],
  ['Tunggu pemuatan data cloud selesai sebelum memilih penyiapan awal.', 'Wait for cloud data to finish loading before choosing initial setup.'],
  ['Sesi berubah; impor dibatalkan.', 'The session changed; the import was cancelled.'],
  ['Tunggu pemuatan data cloud pertama selesai sebelum mengimpor cadangan.', 'Wait for the initial cloud read to finish before importing a backup.'],
  ['Selesaikan konflik sinkronisasi sebelum mengimpor cadangan.', 'Resolve the synchronization conflict before importing a backup.'],
  ['Mode impor tidak valid.', 'The import mode is invalid.'],
  ['Masuk terlebih dahulu untuk mengimpor data tamu.', 'Sign in before importing guest data.'],
  ['Tidak ada data tamu aktif untuk diimpor.', 'There is no active guest data to import.'],
  ['Hasil replace tidak valid.', 'The replacement result is invalid.'],
  ['Impor data tamu hanya mendukung Gabungkan (Merge). Gunakan impor file untuk Ganti (Replace).', 'Guest import only supports Merge. Use file import for Replace.'],
  ['Data berubah sejak pratinjau. Perbarui pratinjau sebelum menyimpan.', 'Data changed since the preview. Refresh the preview before saving.'],
  ['Selesaikan pilihan pada pratinjau merge sebelum menyimpan.', 'Complete the choices in the merge preview before saving.'],
  ['Sesi berubah; pemeriksaan data tamu dibatalkan.', 'The session changed; checking guest data was cancelled.'],
  ['Masuk terlebih dahulu untuk mengimpor data tamu pada sesi yang aktif.', 'Sign in to the active session before importing guest data.'],
  ['Impor data tamu hanya mendukung Gabungkan (Merge).', 'Guest import only supports Merge.'],
  ['Gunakan pilihan pemulihan pada pratinjau Merge data tamu.', 'Use the recovery option in the guest data Merge preview.'],
  ['Gunakan nominal rupiah bulat; angka desimal atau format ini tidak didukung.', 'Use a whole rupiah amount; decimals or this format are not supported.'],
  ['Nominal melampaui batas aman.', 'The amount exceeds the safe integer range.'],
  ['Total nominal melampaui batas aman.', 'The total amount exceeds the safe integer range.'],
  ['Total nominal melampaui batas aman', 'The total amount exceeds the safe integer range'],
  ['Status impor tamu tidak valid.', 'The guest import status is invalid.'],
  ['Pemetaan merge tidak valid.', 'The merge mapping is invalid.'],
  ['Pemetaan merge tidak lengkap.', 'The merge mapping is incomplete.'],
  ['Identitas merge tidak valid.', 'The merge identity is invalid.'],
  ['Pemetaan pemulihan tidak valid.', 'The recovery mapping is invalid.'],
  ['Pemetaan pemulihan tidak lengkap.', 'The recovery mapping is incomplete.'],
  ['Identitas pemulihan tidak valid.', 'The recovery identity is invalid.'],
  ['Identitas pemulihan duplikat.', 'The recovery identity is duplicated.'],
  ['Versi backup tidak didukung.', 'This backup version is not supported.'],
  ['Backup memuat ID yang sudah dimusnahkan. Gunakan pilihan Pulihkan sebagai data baru pada impor cadangan.', 'The backup contains permanently deleted IDs. Choose Restore as new data when importing the backup.'],
  ['Hasil merge tidak valid.', 'The merge result is invalid.'],
  ['Timestamp tidak valid.', 'The timestamp is invalid.'],
  ['ID data harus berupa UUID.', 'Data IDs must be UUIDs.'],
  ['Jenis akun tidak valid.', 'The account type is invalid.'],
  ['Kategori harus pemasukan atau pengeluaran.', 'A category must be income or expense.'],
  ['Jenis transaksi tidak valid.', 'The transaction type is invalid.'],
  ['ID akun transaksi tidak valid.', 'The transaction account ID is invalid.'],
  ['Tanggal transaksi tidak valid.', 'The transaction date is invalid.'],
  ['Catatan maksimal 2000 karakter.', 'Notes must not exceed 2000 characters.'],
  ['ID kategori tidak valid.', 'The category ID is invalid.'],
  ['ID akun tujuan tidak valid.', 'The target account ID is invalid.'],
  ['Referensi transaksi tidak sesuai jenisnya.', 'The transaction references do not match its type.'],
  ['ID kategori anggaran tidak valid.', 'The budget category ID is invalid.'],
  ['Preferensi tidak valid.', 'The preferences are invalid.'],
  ['Penanda penghapusan tidak valid.', 'The deletion markers are invalid.'],
  ['Data yang dimusnahkan tidak boleh dihidupkan kembali dengan ID yang sama.', 'Permanently deleted data cannot be restored with the same ID.'],
  ['Akun transaksi tidak tersedia; pulihkan akun terlebih dahulu.', 'The transaction account is unavailable; restore the account first.'],
  ['Akun tujuan transfer harus tersedia dan berbeda.', 'The transfer target account must be available and different from the source.'],
  ['Kategori transaksi tidak tersedia atau jenisnya tidak sesuai.', 'The transaction category is unavailable or its type does not match.'],
  ['Anggaran memerlukan kategori pengeluaran yang tersedia.', 'A budget requires an available expense category.'],
  ['ID ini sudah dimusnahkan di cloud. Ekspor cadangan lokal bila diperlukan, lalu gunakan versi cloud. Data hanya dapat dibuat ulang sebagai entitas baru.', 'This ID was permanently deleted in the cloud. Export a local backup if needed, then use the cloud version. The data can only be recreated as a new item.'],
  ['Penyimpanan IndexedDB tidak tersedia. Gunakan browser dengan penyimpanan situs aktif.', 'IndexedDB storage is unavailable. Use a browser with site storage enabled.'],
  ['Penyimpanan sedang diperbarui di tab lain. Tutup tab Fisku lain lalu muat ulang.', 'Storage is being upgraded in another tab. Close other Fisku tabs and reload.'],
  ['Data lokal lama tidak valid. Sumber asli dipertahankan. Ekspor data pemulihan sebelum melanjutkan.', 'Legacy local data is invalid. The original source is preserved. Export recovery data before continuing.'],
  ['Pemilik penyimpanan tidak valid.', 'The storage owner is invalid.'],
  ['Metadata penyimpanan tidak valid; sumber asli tidak diubah.', 'Storage metadata is invalid; the original source has not been changed.'],
  ['Antrean sinkronisasi tidak valid.', 'The synchronization queue is invalid.'],
  ['Metadata konflik tidak valid.', 'The conflict metadata is invalid.'],
  ['Metadata perlindungan cadangan tidak valid.', 'The backup protection metadata is invalid.'],
  ['Status penyiapan awal tidak valid.', 'The initial setup status is invalid.'],
  ['Cadangan ini dilindungi sampai konflik diselesaikan.', 'This backup is protected until the conflict is resolved.'],
  ['Callback transaksi harus sinkron.', 'The transaction callback must be synchronous.'],
  ['Penyimpanan dibatalkan. Data belum disimpan.', 'Saving was cancelled. The data has not been saved.'],
  ['Template hanya dapat ditambahkan saat tidak ada data keuangan aktif.', 'A template can only be applied when there is no active financial data.'],
  ['Konfigurasi Supabase tidak valid. Periksa URL dan public anon key.', 'The Supabase configuration is invalid. Check the URL and public anon key.'],
  ['Gagal memuat data pengguna.', 'Failed to load user data.'],
  ['Cloud tidak dikonfigurasi.', 'Cloud is not configured.'],
  ['Sesi berubah; hasil sinkronisasi tidak diterapkan.', 'The session changed; synchronization results were not applied.'],
  ['Sesi pengguna berubah. Masuk kembali sebelum sinkronisasi.', 'The user session changed. Sign in again before synchronizing.'],
  ['Sesi berubah.', 'The session changed.'],
  ['Data konflik berubah. Periksa perbandingan terbaru sebelum memilih kembali.', 'Conflict data changed. Review the latest comparison before choosing again.'],
  ['Percobaan sinkronisasi sudah selesai.', 'The synchronization attempt has finished.'],
  ['Versi database cloud tidak valid.', 'The cloud database revision is invalid.'],
  ['Pengakuan versi cloud tidak valid.', 'The cloud revision acknowledgement is invalid.'],
  ['Data masih berubah di perangkat lain. Perubahan lokal tetap tersimpan; sinkronisasi akan dicoba lagi.', 'Data is still changing on another device. Local changes remain saved; synchronization will be retried.'],
  ['Operasi gagal. Data belum disimpan.', 'The operation failed. The data has not been saved.'],
  ['Gagal memuat perubahan data.', 'Failed to load data changes.'],
  ['Gagal membuka penyimpanan lokal.', 'Failed to open local storage.'],
  ['Gagal memeriksa data tamu.', 'Failed to check guest data.'],
  ['Data berubah sejak konfirmasi. Periksa Sampah terbaru sebelum memulihkan semua.', 'Data changed since confirmation. Review the latest Trash before restoring all items.'],
  ['menyiapkan sinkronisasi', 'preparing synchronization'],
  ['memeriksa sesi', 'checking session'],
  ['memvalidasi pengguna', 'validating user'],
  ['membaca data cloud', 'reading cloud data'],
  ['mengirim perubahan', 'sending changes'],
  ['membaca penyimpanan lokal', 'reading local storage'],
  ['menyimpan hasil lokal', 'saving local results'],
  ['memuat hasil lokal', 'loading local results'],
  ['Email atau kata sandi salah.', 'Invalid login credentials'],
  ['Email belum dikonfirmasi. Periksa email Anda.', 'Email not confirmed'],
  ['Batas pengiriman email tercapai. Coba lagi nanti.', 'Email rate limit exceeded'],
  ['Terlalu banyak permintaan. Coba lagi nanti.', 'Too many requests'],
  ['Tautan pemulihan tidak valid atau kedaluwarsa. Minta tautan baru.', 'Token has expired or is invalid'],
  ['Pengguna tidak ditemukan.', 'User not found'],
  ['Pengguna sudah terdaftar.', 'User already registered'],
  ['Kata sandi baru harus berbeda dari kata sandi lama.', 'New password should be different from the old password.'],
  ['Masuk terlebih dahulu untuk melanjutkan.', 'Authentication required'],
  ['Operasi sinkronisasi tidak valid.', 'Invalid operation'],
  ['Data cloud tidak valid.', 'Invalid data'],
  ['Daftar data cloud tidak valid.', 'Invalid data arrays'],
  ['ID operasi digunakan kembali dengan data berbeda.', 'Operation ID reused with different data'],
  ['Data cloud berubah; baca ulang sebelum menyinkronkan.', 'Cloud changed; reconcile first'],
  ['Ada identitas yang hilang; penghapusan harus dinyatakan secara eksplisit.', 'Missing identities; explicit deletion required'],
  ['Penanda pemusnahan tidak boleh dihapus.', 'Purge markers cannot be removed'],
  ['Identitas yang sudah dimusnahkan tidak dapat dipulihkan.', 'Permanently removed identity cannot be restored'],
  ['Relasi atau jenis transaksi tidak valid', 'The transaction relationships or type are invalid'],
  ['Relasi anggaran tidak valid', 'The budget relationships are invalid'],
  ['Saldo melampaui batas aman', 'The balance exceeds the safe integer range'],
  ['Total saldo melampaui batas aman', 'The total balance exceeds the safe integer range'],
  ['Total anggaran melampaui batas aman', 'The total budget exceeds the safe integer range'],
  ['Koneksi jaringan gagal. Perubahan lokal tetap tersimpan.', 'Failed to fetch'],
  ['Ruang penyimpanan perangkat penuh. Data belum disimpan.', 'The quota has been exceeded.'],
]

const exact = new Map<string, readonly [string, string]>()
function add(pair: readonly [string, string]) { exact.set(pair[0], pair); exact.set(pair[1], pair) }
for (const [key, value] of Object.entries(translations.id)) {
  const english = translations.en[key as keyof typeof translations.en]
  if (typeof value === 'string' && typeof english === 'string') add([value, english])
}
for (const pair of messages) add(pair)

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates: { expression: RegExp; keys: string[]; id: string; en: string }[] = []
for (const [key, value] of Object.entries(translations.id)) {
  const english = translations.en[key as keyof typeof translations.en]
  if (typeof value !== 'string' || typeof english !== 'string' || !/\{\w+\}/.test(value)) continue
  for (const source of [value, english]) {
    let pattern = '^'; let offset = 0; const keys: string[] = []
    for (const placeholder of source.matchAll(/\{(\w+)\}/g)) {
      pattern += escape(source.slice(offset, placeholder.index)) + (/^(n|deleted|purged)$/.test(placeholder[1]) ? '(\\d+)' : '([\\s\\S]*?)')
      keys.push(placeholder[1]); offset = placeholder.index! + placeholder[0].length
    }
    templates.push({ expression: new RegExp(pattern + escape(source.slice(offset)) + '$'), keys, id: value, en: english })
  }
}

const labels: Record<string, string> = { 'Data': 'Data', 'Nama akun': 'Account name', 'Nama kategori': 'Category name', 'Saldo awal': 'Opening balance', 'Nominal transaksi': 'Transaction amount', 'Batas anggaran': 'Budget limit', 'Anggaran kategori': 'Category budget', 'Preferensi': 'Preferences', 'Penanda penghapusan': 'Deletion markers', accounts: 'Accounts', categories: 'Categories', transactions: 'Transactions', budgets: 'Budgets' }
const label = (value: string, lang: Language) => lang === 'en' ? labels[value] ?? value : Object.entries(labels).find(([, en]) => en === value)?.[0] ?? value

export function localizeMessage(message: string, lang: Language): string {
  const known = exact.get(message)
  if (known) return known[lang === 'id' ? 0 : 1]
  for (const template of templates) {
    const captures = template.expression.exec(message)
    if (captures) return template[lang].replace(/\{(\w+)\}/g, (_placeholder, key: string) => {
      const value = captures[template.keys.indexOf(key) + 1]
      return key === 'parent' ? localizeMessage(value, lang) : value
    })
  }
  let match: RegExpExecArray | null
  if ((match = /^(.+): gunakan bilangan rupiah bulat dalam batas aman\.$/.exec(message))) return lang === 'id' ? message : `${label(match[1], lang)}: use a whole rupiah amount within the safe integer range.`
  if ((match = /^(.+) tidak valid \(maksimal (\d+) karakter\)\.$/.exec(message))) return lang === 'id' ? message : `${label(match[1], lang)} is invalid (maximum ${match[2]} characters).`
  if ((match = /^(.+) duplikat; tentukan pemetaan data terlebih dahulu\.$/.exec(message))) return lang === 'id' ? message : `Duplicate ${label(match[1], lang).toLowerCase()}; choose the data mapping first.`
  if ((match = /^ID (accounts|categories|transactions|budgets) duplikat\.$/.exec(message))) return lang === 'id' ? message : `Duplicate ${label(match[1], lang).toLowerCase()} IDs.`
  if ((match = /^Daftar (accounts|categories|transactions|budgets) tidak valid\.$/.exec(message))) return lang === 'id' ? message : `The ${label(match[1], lang).toLowerCase()} list is invalid.`
  if ((match = /^(.+) tidak valid\.$/.exec(message)) && labels[match[1]]) return lang === 'id' ? message : `${label(match[1], lang)} is invalid.`
  if ((match = /^Sinkronisasi terlalu lama saat (.+)\. Perubahan lokal dan antrean tetap disimpan\. Coba lagi; jika berulang, muat ulang aplikasi\.$/.exec(message))) return lang === 'id' ? message : `Synchronization timed out while ${localizeMessage(match[1], lang)}. Local changes and the queue are preserved. Retry; if it happens again, reload the app.`
  if ((match = /^Konflik perubahan \((\d+)\): ([\s\S]+)\. Versi lokal dan cloud tetap tersimpan\.$/.exec(message))) return lang === 'id' ? message : `Conflicting changes (${match[1]}): ${localizeMessage(match[2], lang)}. Local and cloud versions are preserved.`
  if (message.startsWith('relasi: ')) return lang === 'id' ? message : `relationships: ${localizeMessage(message.slice(8), lang)}`
  if (lang === 'en' && /\((dimusnahkan di cloud|hapus lokal dan edit cloud)\)/.test(message)) return message.replaceAll('(dimusnahkan di cloud)', '(permanently deleted in cloud)').replaceAll('(hapus lokal dan edit cloud)', '(local deletion and cloud edit)')
  if (/^(?:SyntaxError: )?(?:Unexpected token|Unexpected end of JSON|Expected property name|Expected double-quoted property|Unterminated string|Bad control character)/.test(message)) return lang === 'id' ? 'File JSON tidak valid. Periksa format cadangan.' : 'The JSON file is invalid. Check the backup format.'
  if (/^(?:TypeError: )?(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/.test(message)) return localizeMessage('Failed to fetch', lang)
  return message
}

export const browserLanguage = (): Language => typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('id') ? 'id' : 'en'
