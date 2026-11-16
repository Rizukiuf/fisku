# Fisku

Aplikasi keuangan pribadi **local-first** dengan React, TypeScript, dan IndexedDB. Supabase menyediakan login email/password serta sinkronisasi opsional; pencatatan lokal tersedia tanpa akun.

## Menjalankan aplikasi

Gunakan versi Node yang sesuai dengan `engines` di [package.json](package.json). Instalasi berulang memakai lockfile:

```powershell
npm.cmd ci
npm.cmd run dev
```

Perintah dijalankan dari root proyek. Di terminal selain PowerShell, `npm` dapat digunakan sebagai pengganti `npm.cmd`. Konfigurasi Supabase tidak diperlukan untuk penggunaan lokal.

## Perilaku utama

- Catat pemasukan, pengeluaran, transfer, akun, kategori, dan batas anggaran kategori yang digunakan ulang setiap bulan.
- Workspace baru menawarkan template opsional atau mulai kosong. Reset memindahkan data aktif ke Sampah tanpa membuat ulang template.
- Penyimpanan dianggap berhasil sesudah transaksi IndexedDB selesai. Data tamu dan tiap pengguna terpisah; pemindahan data tamu ke akun memerlukan impor eksplisit.
- Banner lintas halaman menawarkan review data tamu, penyelesaian konflik dan retry/detail kegagalan sync. Pending normal cukup ditunjukkan indikator; tidak membuka pop-up otomatis.
- Impor file JSON menyediakan **Gabungkan (Merge)** atau **Ganti (Replace)** dengan pratinjau pemetaan, konflik, dan saldo. Impor data tamu khusus Merge dan ditawarkan bila ada sumber yang perlu ditinjau; transaksi mirip membutuhkan keputusan pengguna.
- Cadangan otomatis normal dibatasi lima per workspace dan dideduplikasi. Salinan konflik yang belum selesai dilindungi. Simpan juga ekspor di luar browser.
- Sampah menyediakan pemulihan satu per satu atau Pulihkan semua, dengan pemeriksaan relasi dan laporan data yang belum dapat dipulihkan.
- Reset semua data dan pemusnahan permanen tersedia di Alat lanjutan; Ekspor/Impor tetap di bagian Data.
- Bahasa Indonesia/Inggris berlaku pada antarmuka tanpa mengubah nama akun, kategori atau catatan pengguna.
- Offline didukung saat aplikasi sudah terbuka. Belum tersedia service worker untuk membuka ulang situs tanpa jaringan.
- Penyimpanan browser terikat origin: host, port, atau domain berbeda memiliki ruang data berbeda.

## Build dan pengujian

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
```

Build menghasilkan `dist`. `npm.cmd run preview` menyajikannya untuk pemeriksaan lokal. Tes browser memakai Chrome lokal atau Chromium pada CI; rincian lingkungan dan batas bukti tersedia di panduan pengujian.

## Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [Panduan agent](AGENTS.md) | Aturan pengerjaan dan perlindungan data |
| [Arsitektur](docs/IMPLEMENTATION.md) | Model, peta kode, penyimpanan, sinkronisasi, dan batas desain |
| [Panduan impor](docs/IMPORT_GUIDE.md) | Merge/Replace, pemetaan, duplikat, dan pemulihan |
| [Supabase dan deployment](docs/SUPABASE_SETUP.md) | Database baru/upgrade, auth, konfigurasi, hosting, dan pemulihan |
| [Pengujian](docs/VALIDATION.md) | Perintah, cakupan, hasil yang terverifikasi, dan pemeriksaan layanan nyata |
| [Status tindak lanjut](docs/HANDOFF.md) | Tahap aktif dan pekerjaan yang belum diverifikasi |

Untuk mengaktifkan cloud, ikuti panduan Supabase. Nilai `VITE_*` tersedia di browser; gunakan public publishable/anon key, bukan secret/service-role key atau password database.

Untuk deploy, ikuti [langkah publikasi](docs/SUPABASE_SETUP.md#5-deploy-untuk-pengujian). Git memakai branch `main`; status hosting dan pekerjaan tersisa dicatat di HANDOFF. `.env`, dependency, hasil build dan artefak tes tidak dicatat ke Git.
