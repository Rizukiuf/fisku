# Panduan agent Fisku

## Konteks dan urutan membaca

Fisku adalah aplikasi keuangan pribadi React/TypeScript, local-first dengan IndexedDB dan Supabase opsional. Login cloud memakai email/password. Bahasa dokumentasi dan laporan kepada pengguna adalah Indonesia; simbol kode mengikuti pola repository.

1. Baca [status tindak lanjut](docs/HANDOFF.md).
2. Baca [arsitektur](docs/IMPLEMENTATION.md).
3. Gunakan [panduan impor](docs/IMPORT_GUIDE.md), [setup Supabase](docs/SUPABASE_SETUP.md), dan [pengujian](docs/VALIDATION.md) sesuai pekerjaan.

Dokumentasi menjelaskan kondisi yang berlaku, bukan kronologi sesi. Periksa kode sebelum mengubah perilaku. Bedakan implementasi, hasil uji, usulan, dan pekerjaan yang belum diverifikasi. Peta modul ada di dokumen arsitektur; jangan menggandakannya di sini.

## Batas lingkup dan UI

- Pertahankan React, router hash yang ada, IDR bulat, serta Supabase opsional.
- Pertahankan layout, warna, tipografi, navigasi, dan susunan UI. Perubahan UI hanya untuk kebutuhan fungsi atau mekanisme yang disetujui pengguna; gunakan pola visual yang ada dan jelaskan alasannya.
- Tidak ada mandat penyelamatan data versi lama. Namun data yang sudah dibuat tetap harus dilindungi; jangan memakai reset, purge, clear storage, atau penghapusan tabel sebagai solusi bug.
- Validasi keunikan/relasi berjalan otomatis. Jangan menambahkan pemeriksaan manual yang hanya mengembalikan nol atau pembersihan duplikat berdasarkan nama tanpa review.

## Invarian penyimpanan

- Publikasikan state dan sukses hanya sesudah commit lokal. Kegagalan baca/write/quota/JSON/jaringan/database harus terlihat dan tidak menghasilkan commit sebagian.
- Pisahkan data, pending, baseline, checkpoint, status, cadangan, dan cache pemetaan guest serta tiap pengguna. Login tidak boleh mengadopsi data guest otomatis.
- Pertahankan guard scope/generation, pemeriksaan editor/pratinjau kedaluwarsa, dan transaksi lintas tab.
- Validasi safe integer pada nominal dan agregasi. Saldo awal boleh negatif; transaksi dan anggaran aktif harus positif. Transfer memerlukan dua akun berbeda tanpa kategori; income/expense memerlukan kategori yang sesuai.
- Periksa relasi pada domain dan database. RLS tidak menggantikan foreign key atau validasi.
- Workspace baru kosong sampai pengguna memilih template atau membuat data. Penyiapan disimpan lokal per workspace; riwayat tombstone/purge/base/revision juga menentukan apakah workspace sudah digunakan.
- Tunggu pembacaan cloud awal untuk owner/generation aktif sebelum menawarkan penyiapan cloud. Jangan mengganggu recovery password.
- Reset mengosongkan data aktif, mempertahankan preferensi, sampah dan marker purge, serta tidak membuat template atau memunculkan dialog awal kembali. Reset kosong tidak membuat cadangan/tombstone; bila penyiapan masih pending, metadata selesai dicatat satu kali.
- Form transaksi mendukung referensi kosong dan pembuatan akun/kategori tanpa kehilangan draft. Referensi yang hilang karena perubahan tab lain harus dipilih ulang secara eksplisit.

## Impor, penghapusan, dan sinkronisasi

- Ikuti kontrak [panduan impor](docs/IMPORT_GUIDE.md). Dialog file memakai Merge sebagai default dan menyediakan Replace. Jalur data tamu hanya Merge, termasuk API `importGuest`; API file `importJSON` tanpa mode tetap memakai Replace untuk kompatibilitas.
- Status selesai impor tamu disimpan atomik per owner sebagai fingerprint sumber aktif. Jangan menghapus sumber guest atau menyinkronkan receipt ke cloud. Sumber kosong/tanpa perubahan tidak ditawarkan; sumber yang berubah dapat ditinjau kembali.
- Merge mempertahankan data/preferensi lokal dan mengabaikan sampah/purge sumber. Saldo awal dan limit tidak dijumlahkan; kemiripan transaksi bukan bukti duplikat.
- Cache `importIds` dan `mergeIds` hanya menyimpan pemetaan UUID lokal per owner, tidak masuk ekspor/cloud. Snapshot transaksi yang memuat identitas asli dan salinannya harus mempertahankan keduanya.
- Periksa isi state dan cache saat commit review, bukan hanya versi/timestamp heartbeat. Batalkan pratinjau yang berubah sampai diperbarui.
- Hapus biasa memakai tombstone yang dapat dipulihkan secara eksplisit. ID purged tidak boleh digunakan ulang. Pemulihan cadangan dengan ID baru harus meremap seluruh graph dan mempertahankan marker lokal.
- Jangan menghilangkan tombstone/marker purge tanpa protokol retensi dan resinkronisasi. Penghapusan perlu sampai ke perangkat offline.
- Snapshot pending disimpan sebelum request dan memakai ID operasi idempotent. Pengakuan request lama tidak boleh membuang edit lokal baru. Jam perangkat atau `max(updatedAt)` bukan bukti semua perubahan sudah tersimpan/terkirim.
- Cadangan normal dideduplikasi dan dibatasi lima per workspace. Salinan konflik belum selesai dilindungi di luar batas itu. Hapus cadangan terpisah dari data/pending dan memeriksa scope/generation.

## Database, konfigurasi, dan verifikasi

- `supabase/migrations/001_init.sql` hanya untuk bootstrap database baru yang kosong, dijalankan satu kali. Perubahan schema setelah database digunakan memerlukan migrasi lanjutan; ambil salinan dan siapkan jalur pemulihan sebelum menyentuh data tersimpan.
- Jangan menghubungkan tes ke database berisi data nyata tanpa mengetahui target dan cadangannya.
- Jangan mencatat secret/service-role key, password database, token sesi, atau data keuangan nyata dalam kode, dokumentasi, fixture, maupun log. Semua `VITE_*` masuk client.
- Gunakan `npm.cmd` bila wrapper PowerShell diblokir; jangan mengubah kebijakan sistem. Instalasi berulang memakai `npm.cmd ci`.
- Untuk kode, jalankan verifikasi sesuai [VALIDATION.md](docs/VALIDATION.md). Untuk dokumentasi/komentar saja, cek tautan, referensi, konsistensi dan bahwa kode aktif tidak berubah.
- Tes PGlite serta auth/RPC tiruan bukan bukti deployment, pengiriman email, atau layanan Supabase nyata berhasil.

## Pemeliharaan dokumentasi

Setiap dokumen memiliki satu fungsi sebagaimana indeks README. Perbarui dokumen yang menjadi sumber informasinya; hindari salinan aturan dan angka tes di banyak tempat. Tulis komentar untuk menjelaskan alasan atau kontrak yang tidak jelas dari kode, bukan menampung implementasi nonaktif.

Saat menutup pekerjaan, perbarui HANDOFF dengan status aktif, verifikasi relevan dan langkah tersisa. Catat keputusan arsitektur yang masih berlaku di IMPLEMENTATION dan bukti pengujian di VALIDATION. Ganti informasi yang sudah tidak berlaku; jangan menambah kronologi sesi, audit selesai, atau rencana yang sudah dilaksanakan.
