import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserLanguage, localizeMessage } from '../src/lib/messages'

afterEach(() => vi.unstubAllGlobals())
describe('presentation language without changing domain data', () => {
  it.each([
    ['Sesi berubah; impor dibatalkan.', 'The session changed; the import was cancelled.'],
    ['Saldo awal: gunakan bilangan rupiah bulat dalam batas aman.', 'Opening balance: use a whole rupiah amount within the safe integer range.'],
    ['Nama akun duplikat; tentukan pemetaan data terlebih dahulu.', 'Duplicate account name; choose the data mapping first.'],
    ['Nama kategori tidak valid (maksimal 200 karakter).', 'Category name is invalid (maximum 200 characters).'],
    ['ID transactions duplikat.', 'Duplicate transactions IDs.'],
    ['Daftar accounts tidak valid.', 'The accounts list is invalid.'],
    ['Penanda penghapusan tidak valid.', 'The deletion markers are invalid.'],
    ['accounts tidak valid.', 'Accounts is invalid.'],
    ['Data konflik berubah. Periksa perbandingan terbaru sebelum memilih kembali.', 'Conflict data changed. Review the latest comparison before choosing again.'],
    ['memeriksa sesi', 'checking session'],
    ['membaca data cloud', 'reading cloud data'],
  ])('localizes controlled app message: %s', (original, english) => {
    expect(localizeMessage(original, 'en')).toBe(english)
    expect(localizeMessage(original, 'id')).toBe(original)
  })
  it.each([
    ['Invalid login credentials', 'Email atau kata sandi salah.'],
    ['Email not confirmed', 'Email belum dikonfirmasi. Periksa email Anda.'],
    ['Purge markers cannot be removed', 'Penanda pemusnahan tidak boleh dihapus.'],
    ['Cloud changed; reconcile first', 'Data cloud berubah; baca ulang sebelum menyinkronkan.'],
    ['Failed to fetch', 'Koneksi jaringan gagal. Perubahan lokal tetap tersimpan.'],
  ])('localizes known provider errors without changing their original messages: %s', (original, indonesian) => {
    expect(localizeMessage(original, 'id')).toBe(indonesian)
    expect(localizeMessage(original, 'en')).toBe(original)
  })
  it('keeps timeout stage and preservation instructions in the selected language', () => {
    expect(localizeMessage('Sinkronisasi terlalu lama saat mengirim perubahan. Perubahan lokal dan antrean tetap disimpan. Coba lagi; jika berulang, muat ulang aplikasi.', 'en')).toBe('Synchronization timed out while sending changes. Local changes and the queue are preserved. Retry; if it happens again, reload the app.')
  })
  it('keeps UUIDs intact when localizing technical conflict details', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(localizeMessage(`Konflik perubahan (1): accounts/${id} (dimusnahkan di cloud). Versi lokal dan cloud tetap tersimpan.`, 'en')).toBe(`Conflicting changes (1): accounts/${id} (permanently deleted in cloud). Local and cloud versions are preserved.`)
    expect(localizeMessage('relasi: Kategori transaksi tidak tersedia atau jenisnya tidak sesuai.', 'en')).toBe('relationships: The transaction category is unavailable or its type does not match.')
  })
  it('relocalizes parameterized notices after a language change without changing counts', () => {
    expect(localizeMessage('13 data dipulihkan.', 'en')).toBe('13 items restored.')
    expect(localizeMessage('2 items remain in Trash.', 'id')).toBe('2 data tetap di Sampah.')
    expect(localizeMessage('1 data dipulihkan.', 'en')).toBe('1 item restored.')
    expect(localizeMessage('1 item remains in Trash.', 'id')).toBe('1 data tetap di Sampah.')
    expect(localizeMessage('3 data dimusnahkan permanen', 'en')).toBe('3 items permanently deleted')
  })
  it('does not translate arbitrary financial names or unknown diagnostic text', () => {
    for (const original of ['Tunai', 'Gaji', 'Catatan pribadi: Saldo awal saya', 'Unrecognized provider diagnostic XYZ-42']) expect(localizeMessage(original, 'en')).toBe(original)
  })
  it('presents malformed JSON as a localized validation message', () => {
    expect(localizeMessage('Unexpected end of JSON input', 'id')).toBe('File JSON tidak valid. Periksa format cadangan.')
    expect(localizeMessage('Unexpected token x in JSON at position 2', 'en')).toBe('The JSON file is invalid. Check the backup format.')
  })
  it.each([['id-ID', 'id'], ['en-US', 'en'], ['fr-FR', 'en']])('uses a supported browser language before storage is available (%s)', (locale, expected) => {
    vi.stubGlobal('navigator', { language: locale })
    expect(browserLanguage()).toBe(expected)
  })
})
