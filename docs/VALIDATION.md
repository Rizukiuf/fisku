# Pengujian dan penerimaan

Dokumen ini menjadi sumber hasil tes dan batas buktinya. Perilaku aplikasi dijelaskan di [arsitektur](IMPLEMENTATION.md); konfigurasi target cloud di [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

## Menjalankan pemeriksaan

Dari root proyek, gunakan Node sesuai `package.json` dan dependency dari lockfile:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
```

Pada terminal lain, `npm` dapat menggantikan `npm.cmd`. Playwright lokal memakai Chrome; CI memakai Chromium setelah `npx playwright install --with-deps chromium`. Konfigurasi menjalankan dev server pada port 5175/5176 untuk cloud tiruan dan tanpa cloud. Tes memakai fixture sintetis, bukan proyek/data pengguna nyata.

Workflow [check.yml](../.github/workflows/check.yml) tersedia. Keberadaan workflow bukan bukti eksekusi GitHub berhasil. Tes harus menunggu dialog penyiapan hilang atau data template aktif tampil sebelum mengisi form, membaca state atau menyuntikkan kegagalan write. Sebelum reload setelah pergantian bahasa, tunggu bahasa baru tampil sebagai bukti commit. Klik selesai bukan bukti operasi async selesai; jangan menggantinya dengan jeda waktu tetap. Jangan mengubah source atau dokumentasi selama suite browser berjalan karena Vite dapat memuat ulang halaman.

## Bukti source aplikasi

Status bukti pada **17 November 2026**:

Pemeriksaan mencakup source versi `1.0.0` dan Reset yang berada di Alat lanjutan, dengan handler/konfirmasi yang sama. Skrip perbandingan visual sekali pakai yang memakai baseline/port lama telah dihapus; suite browser tetap menjadi sumber verifikasi UI.

| Pemeriksaan | Hasil | Lingkungan |
| --- | --- | --- |
| TypeScript/Vite build | Exit 0 | Lokal; peringatan bundle >500 kB masih ada |
| Vitest | 232 tes, 15 file lulus | Domain, fake-indexeddb, mesin sync dan PostgreSQL embedded PGlite |
| Playwright | 106 tes, 15 file lulus sebagai satu suite | Chromium headless mode CI di Windows lokal; auth/RPC tiruan |

Build dan kedua suite lulus pada source yang sama, mencakup auth, impor tamu, banner, deadline, jeda retry otomatis setelah timeout, indikator tahap/detik, perbandingan konflik terkini, ekspor bertanggal lokal, bahasa Indonesia/Inggris dan pemulihan massal. Perbaikan konflik revisi meliputi RPC `PT409`, kompatibilitas client legacy `40001`, dan migrasi fungsi pada fixture yang sudah berisi data. Review statis terpisah tidak menyisakan temuan kritis/penting; regresi mencakup konflik tambahan setelah ID lama disimpan serta child terdampak fallback dataset lengkap. Audit teks tidak menyisakan teks JSX/label aksesibilitas milik aplikasi yang di-hardcode di luar katalog/nama merek; key ID/EN berpasangan dan pesan validasi statis tercakup. Tes resolusi konflik menunggu push/pengakuan cloud selesai; hilangnya banner saja bukan bukti upload sudah selesai. Origin pengguna adalah localhost port 5173; muat ulang seluruh tab saat menerapkan client baru. Setelah perubahan perilaku, jalankan pemeriksaan relevan dan ganti status tabel hanya berdasarkan hasil aktual; jangan mengakumulasi riwayat run.

## Cakupan yang tersedia

| Area | Sumber tes | Kasus penting |
| --- | --- | --- |
| Domain dan template | `tests/model.test.ts`, `setup.test.ts` | IDR safe integer/agregasi, tanggal/jenis/referensi, saldo, transfer, template eksplisit tanpa reuse ID |
| IndexedDB dan cadangan | `tests/repository.test.ts`, `backups.test.ts` | Commit/rollback, quota, owner, retensi/deduplikasi/perlindungan, reset kosong, data sumber invalid tetap dipertahankan |
| Penyiapan awal | `tests/onboarding.test.ts` | Pilihan lokal per owner, metadata, dua tab, reset, penundaan dan adaptasi workspace |
| Impor dan pemulihan | `tests/imports.test.ts`, `merge.test.ts`, `merge-repository.test.ts` | Pemetaan/nilai, kandidat transaksi, purge/graph, alias asli-salinan, impor ulang, stale state/alias, heartbeat, owner, rollback, pending |
| Impor tamu | `tests/guest-import.test.ts` | Sepuluh kasus: fingerprint semantik, sumber dipin/tidak dihapus, receipt per owner, no-op/kosong, perubahan sumber, stale receipt, metadata invalid, rollback atomik dan penolakan opsi Replace |
| Mesin sync | `tests/sync.test.ts` | CAS `PT409`/legacy `40001`, pembacaan ulang setelah pending ditolak, ID operasi baru hanya setelah CAS, batas percobaan saat penolakan berulang, respons hilang/retry idempotent, perubahan selama request, tiga arah, konflik dan penghapusan |
| Lifecycle sync | `tests/sync-lifecycle.test.ts` | Overlap sesudah konflik/error, sesi tertahan, pending/ID sama sesudah push timeout, owner lama, batas total, callback commit kedaluwarsa yang tidak menimpa edit baru; keputusan konflik kedaluwarsa karena edit lokal, baseline, revisi konflik atau generasi sesi berubah ditolak tanpa write/push |
| Perbandingan konflik | `tests/conflict-details.test.ts` | Nama/nilai akun, kategori, transaksi, transfer dan anggaran; referensi per snapshot, status Sampah/purge/missing, waktu penghapusan, graph relasi, ID lama/tidak dikenal, nilai sudah sama, identitas berbeda bernama sama, konflik tambahan setelah ID tersimpan, child terdampak fallback dataset dari konflik row biasa, dan builder tanpa mutasi |
| Pemulihan massal | `tests/restore.test.ts` | Urutan parent/child/transfer/budget, UUID tetap, nama aktif/ambigu dilewati tanpa memilih pemenang, kategori berbeda jenis, budget nol, no-op, preferensi/metadata tetap, stale state/owner/generation, backup atomik, quota dan overflow rollback |
| Pesan dua bahasa | `tests/messages.test.ts` | Label dan validasi dinamis, timeout beserta tahap, error provider yang dikenali, UUID teknis tetap, hitungan/plural, pergantian bahasa toast, JSON invalid, fallback browser, dan nama/diagnostik tidak dikenal tidak diubah |
| Database/RLS | `tests/database.test.ts` | Schema utuh, role/izin/RPC, composite FK owner, unique budget, rollback, purge, 1.501 transaksi, roundtrip sync dan dump/restore fixture. Upgrade fungsi legacy ke `PT409` dengan file 002 mempertahankan data, revision, receipt/idempotensi, owner/ACL/OID dan aman diulang. |
| Browser dasar/form | `e2e/app.spec.ts`, `amount-input.spec.ts`, `empty-transactions.spec.ts` | CRUD/reload, dua tab, error simpan, owner, auth/recovery, offline saat terbuka, nominal/kursor, seleksi semua tidak ditimpa frame pemformatan lama, referensi kosong dan draft |
| Browser penyiapan/cadangan | `e2e/onboarding.spec.ts`, `reset-backups.spec.ts` | Mobile, pilihan/reload/race, initial cloud read, reset, retensi/unduh/hapus dan perlindungan konflik |
| Browser impor | `e2e/import-recovery.spec.ts`, `import-merge.spec.ts` | Merge/Replace, saldo/anggaran, transaksi mirip/konflik, purge, stale dua tab, quota, guest, batal dan pagination 51 transaksi |
| Browser auth/tamu | `e2e/auth-forms.spec.ts`, `guest-import.spec.ts` | Signup baru/tersamar kembali login, pesan bersyarat, validasi aplikasi, recovery, password login lama, guest khusus Merge, transaksi/budget tetap, tombol selesai/reload/sumber lintas tab |
| Browser pemberitahuan | `e2e/workspace-notices.spec.ts`, konflik dua konteks pada `app.spec.ts` | Banner lintas halaman/mobile, review/cancel/import, Nanti tanpa write/receipt, sumber berubah, owner, prioritas konflik dan fokus, pilihan lokal/cloud, retry termasuk edit setelah error, offline/reconnect serta pending tanpa modal/banner |
| Browser lifecycle sync | `e2e/sync-lifecycle.spec.ts` | Delapan kasus: sesi SDK dan autentikasi di dalam RPC ditahan; tahap/detik tampil, deadline keluar dari spinner, hasil terlambat diabaikan dan retry mempertahankan data. Refresh sesi owner sama mempertahankan status syncing/error. Jeda timeout bertahan melewati dua menit, fokus, reconnect dan edit; retry manual berhasil dan pergantian owner tidak mewarisi jeda. HTTP 409/`PT409` melewati SDK asli, memaksa fresh read dan menghasilkan merge independen atau konflik isi; dua menit berikutnya tidak mengulang push yang ditolak. |
| Browser rincian konflik | `e2e/conflict-details.spec.ts`, `workspace-notices.spec.ts` | Nilai lokal/cloud, pilihan yang tetap selesai, transaksi/anggaran, tanggal/nominal/referensi/catatan sebagai teks aman, mobile dan ID/EN, relasi, purge, detail ID tertutup, pagination, penolakan konfirmasi setelah nilai berubah, penambahan konflik baru serta child yang akan terdampak fallback dataset |
| Browser ekspor | `e2e/export.spec.ts` | Nama Fisku bertanggal lokal di Jakarta/Los Angeles saat hari berbeda dari UTC; isi JSON dan timestamp UTC saat ekspor tetap utuh; tanggal default transaksi selaras |
| Browser bahasa | `e2e/i18n.spec.ts` | Seluruh status/tahap sync, bulan grafik dan label aksesibilitas, pesan validasi/impor, toast setelah ganti bahasa, reload/navigasi, data keuangan tetap, serta pemulihan startup saat preferensi belum bisa dibaca |
| Browser Pulihkan semua | `e2e/restore-all.spec.ts` | Pemulihan seluruh graph/reload, pemulihan sebagian karena nama/parent atau limit nol, laporan English/Indonesia, cancel, konfirmasi data usang dan kegagalan commit tanpa perubahan data/cadangan |

Tabel merangkum skenario yang ada; bukan klaim seluruh kombinasi kegagalan telah diuji. SQL PGlite tidak membuktikan konfigurasi JWT, jaringan atau operasi hosted Supabase. Simulasi dua perangkat tidak menggantikan uji perangkat nyata.

## Penerimaan cloud dan deployment

Jalankan pada target yang diketahui dengan data sintetis. Laporan pengguna tentang koneksi/pendaftaran tercatat di HANDOFF, tetapi daftar penerimaan lengkap ini belum diverifikasi; tandai selesai hanya setelah butir terkait benar-benar diuji. Pada 17 November 2026 pengguna melaporkan menjalankan `002_revision_conflict.sql`, error tampak berhenti, lalu melakukan restart proyek Supabase. Pengguna juga melaporkan konflik kembali tampil pada browser yang mengedit lebih lambat saat dua browser mengubah data hampir bersamaan. Ini bukti dari pengguna, bukan inspeksi server oleh agent; hasil pemilihan versi hingga kedua browser konsisten dan tidak berulangnya log belum dilaporkan lengkap.

- [ ] Bootstrap/migrasi target, RPC, constraint, RLS dan hak akses aplikasi sesuai schema.
- [x] Migrasi 002 dan restart proyek diterapkan, berdasarkan laporan pengguna; agent tidak menjalankannya pada hosted Supabase.
- [ ] Setelah browser dibuka kembali, sync manual dan edit bersamaan selesai tanpa loop log baru `40001 — Cloud changed; reconcile first`.
- [ ] Daftar, konfirmasi email, login/logout serta password salah menghasilkan sesi/pesan yang tepat.
- [ ] Email konfirmasi dan pemulihan benar-benar diterima; callback lokal/hosting, refresh saat recovery dan link kedaluwarsa ditangani.
- [ ] Guest tidak berpindah otomatis; user A/B terpisah. User yang sama memperoleh data setara di dua perangkat setelah reload/sync.
- [ ] Edit bersamaan mempertahankan perubahan independen; konflik menampilkan pilihan dan kedua cadangan.
- [ ] Koneksi putus/reconnect serta respons push yang hilang tidak menggandakan perubahan atau kehilangan edit. Data lokal tetap tersedia dalam scope yang tepat.
- [ ] Reset, restore dan purge sampai ke perangkat lain; perangkat lama yang online kembali tidak menghidupkan ID purged.
- [ ] Merge/Replace dengan data cloud mempertahankan keputusan, relasi, saldo, pending dan cadangan.
- [ ] Build hosting memakai env public yang tepat, HTTPS serta URL/callback tetap. Guest/data lokal berpindah origin hanya lewat impor/sync yang eksplisit.
- [ ] Backup cloud dipulihkan ke target terpisah; revision, izin, relasi dan perubahan sejak backup ditangani.

Catat tanggal, target/URL tanpa kredensial, versi source bila tersedia, browser/perangkat, skenario, hasil dan error yang dapat direproduksi. Perbarui status di [HANDOFF.md](HANDOFF.md) setelah tahap nyata selesai.

## Percobaan pengguna yang masih perlu dilaporkan

Pengguna sudah melaporkan pendaftaran/konfirmasi email, perubahan yang muncul di browser lain, dan konflik saat edit berdekatan. Tabel berikut memeriksa kelanjutannya pada layanan nyata, termasuk banner baru. Gunakan akun/data percobaan dan nominal kecil; lakukan uji offline dengan aplikasi tetap terbuka. Jangan menjalankan reset/purge pada data rutin sebagai bagian percobaan.

| Percobaan | Langkah | Hasil yang diperiksa |
| --- | --- | --- |
| Penyelesaian konflik | Dua browser mengubah saldo awal satu akun uji menjadi dua nilai berbeda. Dari halaman selain Pengaturan, tekan Periksa konflik, pilih lokal lalu sync kedua browser. Ulangi konflik baru dengan memilih cloud. | Bagian cloud langsung terbuka/fokus; kedua browser berakhir pada nilai pilihan, perubahan independen tetap ada bila relasinya valid, banner konflik hilang dan cadangan tersedia. |
| Offline dan pemulihan koneksi | Putuskan jaringan satu browser, buat transaksi uji, lalu sambungkan kembali. | Banner menjelaskan perubahan tersimpan lokal; setelah sync, browser kedua memperoleh transaksi satu kali dan banner tertunda hilang. |
| Guest, penundaan dan impor | Buat data saat logout, login, periksa banner di Dasbor. Pilih Nanti dan buka tombol impor di Pengaturan; batalkan sekali lalu impor lewat review Merge. | Tidak ada impor otomatis/Replace; Nanti tidak menghapus sumber atau mencatat selesai; impor berhasil menghilangkan penawaran sumber yang sama. Perubahan guest berikutnya dapat ditawarkan lagi. |
| Pemisahan akun | Setelah akun A menunda/mengimpor guest, logout dan login akun B. | Tidak ada data pribadi A atau pesan konflik A; status penundaan/impor A tidak menjadi keputusan B. |
| Hapus, pulihkan dan purge | Gunakan hanya akun/kategori/transaksi uji. Hapus dan sync, pulihkan dan sync. Untuk purge, pastikan relasi child selesai dimusnahkan dan sambungkan browser yang menyimpan versi lama. | Sampah/pemulihan konsisten dan ID purged tidak hidup kembali; konflik purge/edit meminta tindakan yang sesuai. |
| Pulihkan semua dan bahasa | Buat akun/kategori/transaksi/budget uji, hapus ke Sampah, lalu coba Pulihkan semua. Ulangi dengan nama yang dipakai lagi atau budget berbatas nol; ganti bahasa dan sync ke browser kedua. | Parent/child yang memenuhi syarat pulih; data yang dilewati tetap di Sampah dengan alasan, bahasa laporan mengikuti preferensi, dan kedua browser memperoleh hasil sama sesudah sync. |
| Recovery dan deployment | Coba Lupa kata sandi melalui email nyata, buka tautan dan ganti password. Setelah deployment uji, ulangi callback serta sync dua perangkat pada URL HTTPS. | Validasi aplikasi tampil, password baru dapat dipakai dan callback kembali ke origin yang tepat. |

Percobaan fault injection (503, respons push ditahan, edit setelah error dan scope race) dijalankan otomatis pada layanan tiruan. Hasil tersebut tidak mengklaim respons gagal tersebut sudah direproduksi pada proyek Supabase pengguna. Pembatasan akses lintas owner/RLS, restore backup hosted dan batas request nyata tetap mengikuti checklist penerimaan di atas.

Untuk keluhan spinner dengan log server `40001 — Cloud changed; reconcile first` berulang, acuan penanganannya adalah [migrasi dan penghentian proses lama](SUPABASE_SETUP.md#database-terpakai-perbaikan-konflik-revisi). Migrasi dan restart sudah dilaporkan pengguna, dengan indikasi error berhenti. Periksa timestamp entri terbaru, bukan total error pada grafik yang masih mencakup periode sebelum perbaikan. Versi/PID server serta hasil sync setelah pemulihan belum diverifikasi agent; jangan mengulang migrasi/restart tanpa alasan baru.

Sesudah perbaikan server, muat ulang kedua browser dengan Ctrl+Shift+R lalu ulangi pada source client terbaru. Pengaturan menampilkan `Tahap: … · … dtk` ketika sync berjalan. Jika request/sesi tertahan, deadline 15 detik per tahap atau 30 detik total mengakhiri percobaan client; sync otomatis dijeda sampai retry manual. Catat tahap, pesan, durasi serta apakah konflik tersedia. Jika baris tahap belum terlihat, tab belum terbukti menjalankan kode baru. Pending dan database tidak perlu dihapus; abort client bukan jaminan transaksi/retry server berhenti.

## Batas dan verifikasi lanjutan

Agent belum menjalankan tes terhadap hosted Supabase/pengiriman email nyata; laporan percobaan pengguna dicatat terpisah di HANDOFF. PGlite menguji fungsi/migrasi PostgreSQL, dan browser menguji SDK dengan HTTP tiruan; keduanya tidak menjalankan server PostgREST hosted atau membuktikan loop backend lama telah berhenti. Keberhasilan CI GitHub, browser selain Chrome, seluruh variasi token/network, benchmark dataset sangat besar dan batas request proyek nyata belum diverifikasi. Offline cold-start belum diimplementasikan. Pengujian dump/restore PGlite bukan prosedur restore managed Supabase.

Lokalisasi mencakup teks milik aplikasi dan pesan eksternal yang dikenali; diagnostik provider/browser baru yang tidak dikenali tetap memakai teks aslinya. Nama akun/kategori dan catatan adalah data pengguna, bukan label yang diterjemahkan. Audit source memeriksa teks JSX/aksesibilitas, katalog serta pesan validasi statis; perubahan teks baru perlu mengikuti pola yang sama.

Log [CI commit awal](https://github.com/Rizukiuf/fisku/actions/runs/43950754931/job/133592272316) menunjukkan build dan tes unit lulus, tetapi 16 tes browser gagal. Diagnosis dan reproduksi lokal mengonfirmasi langkah tes yang mendahului commit penyiapan/template/preferensi serta bug pemulihan kursor tertunda. Tes regresi seleksi nominal dibuktikan gagal sebelum handler diperbaiki. Seluruh 17 skenario terkait (16 kasus CI dan regresi baru) lulus dalam tiga pengulangan per skenario pada Chromium mode CI lokal. Hasil ini belum membuktikan runner Linux GitHub lulus; commit pengganti yang memuat perbaikan belum dipublikasikan ke remote.

Jika fitur, ukuran dataset atau platform sasaran berubah, tambahkan tes berdasarkan risiko tersebut. Untuk perubahan schema terpakai, uji pada salinan/fixture dan siapkan pemulihan sebagaimana panduan Supabase.

## Perubahan dokumentasi dan komentar

Periksa semua tautan/anchor lokal, referensi file/simbol/perintah, pagar blok kode dan konsistensi keputusan. Pastikan tidak ada referensi ke dokumen yang dihapus atau klaim layanan nyata tanpa bukti.

Jika komentar source dirapikan, bandingkan kode aktif sebelum/sesudah. Build dapat dipakai untuk memeriksa hasil source; jalankan tes perilaku bila ada perubahan kode aktif. Jangan menambah tes yang hanya meniru teks dokumentasi atau penghapusan komentar.
