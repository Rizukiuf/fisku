# Supabase dan deployment

Supabase opsional untuk login email/password dan sinkronisasi. Gunakan proyek pengujian serta data sintetis sebelum pemakaian rutin. Bukti tes lokal dan penerimaan layanan nyata dipisahkan di [VALIDATION.md](VALIDATION.md).

## 1. Database baru

1. Pastikan target adalah proyek dengan database aplikasi yang masih kosong.
2. Di SQL Editor, jalankan [001_init.sql](../supabase/migrations/001_init.sql) **satu kali**. File berisi tabel, constraint/FK, indeks, RLS, revision, ledger operasi, marker purge dan RPC.
3. Pastikan `public.finance_read` dan `public.finance_push` tersedia. Aplikasi menulis melalui RPC tersebut.

Bootstrap dibungkus transaksi, tetapi bukan reset atau upgrade database terpakai. Jika schema sudah ada, periksa kondisinya sebelum melanjutkan; perubahan berikutnya memerlukan migrasi lanjutan. Jangan menghapus tabel untuk mengatasi kegagalan instalasi.

## Database terpakai: perbaikan konflik revisi

Gunakan [002_revision_conflict.sql](../supabase/migrations/002_revision_conflict.sql) untuk database yang sudah memakai bootstrap Fisku. Bootstrap terbaru sudah memakai kontrak yang sama; tooling migrasi dapat menjalankan kedua file berurutan. Jangan menjalankan ulang `001_init.sql` pada database terpakai.

Fungsi lama memakai SQLSTATE `40001` untuk konflik expected revision. Kode itu berarti kegagalan serialisasi PostgreSQL dan dapat membuat PostgREST mengulang request yang sama di server tanpa mengembalikan respons. Client tidak sempat membaca revisi baru. `PT409` mengembalikan HTTP 409 agar client membaca ulang dan melakukan rekonsiliasi. Masalah serta penanganan proses lama dijelaskan dalam [KB resmi Supabase](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b); pemetaan `PT` dijelaskan dalam [dokumentasi PostgREST](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes).

Urutan penerapan pada proyek yang sudah dipakai:

1. Pastikan aplikasi memakai source terbaru yang mengenali `PT409`, lalu tutup seluruh tab aplikasi. Client lama hanya mengenali `40001` dan tidak dapat melanjutkan rekonsiliasi kode baru. Tutup tab tanpa menghapus storage/pending.
2. Ambil cadangan cloud sebagaimana bagian pemulihan di bawah. Simpan juga hasil query berikut sebagai salinan definisi RPC sebelum menggantinya:

   ```sql
   select pg_get_functiondef('public.finance_push(bigint,uuid,jsonb)'::regprocedure);
   ```

3. Di SQL Editor target yang benar, jalankan seluruh isi `002_revision_conflict.sql`. File mengganti definisi RPC dalam satu transaksi; tidak menjalankan RPC atau menulis ulang data keuangan, revision, marker purge maupun ledger operasi. `CREATE OR REPLACE` mempertahankan owner/izin fungsi. Batas tunggu lock lima detik mencegah migrasi menunggu tanpa batas. Jika transaksi gagal, jalankan `rollback;` bila editor masih berada dalam transaksi gagal, tangani hambatannya lalu ulangi file ini.
4. **Hentikan proses lama yang masih berulang.** Penggantian fungsi dan timeout browser tidak menjamin transaksi yang sudah berjalan berhenti. Cocokkan `process_id` dari log baru `40001` dengan `pid` kandidat berikut:

   ```sql
   select pid, state, query_start, xact_start, wait_event_type, wait_event
   from pg_stat_activity
   where usename = 'authenticator'
     and pid <> pg_backend_pid()
     and query ilike '%finance_push%'
   order by query_start;
   ```

   Setelah PID dipastikan cocok dengan log terbaru, ganti `0` pada query di bawah dengan **satu PID yang sudah diverifikasi**. Ulangi hanya bila ada proses lain yang juga terbukti cocok. Jangan menghentikan seluruh koneksi secara massal.

   ```sql
   select pg_terminate_backend(pid)
   from pg_stat_activity
   where pid = 0 -- Ganti dengan process_id yang cocok dari log terbaru.
     and usename = 'authenticator'
     and pid <> pg_backend_pid()
     and query ilike '%finance_push%';
   ```

   Penghentian membatalkan transaksi koneksi itu yang belum commit; data yang sudah commit tetap ada dan pending client tetap tersedia untuk retry. Jika role tidak diizinkan atau proses sulit dipastikan, restart proyek melalui dashboard merupakan alternatif resmi yang memutus koneksi sementara tanpa menghapus data. Jika proses lama menghalangi lock migrasi, hentikan proses yang telah diverifikasi terlebih dahulu, kemudian ulangi migrasi.
5. Pastikan tidak ada log baru `40001 — Cloud changed; reconcile first` saat semua tab tertutup. Angka total dan grafik periode sebelumnya tetap memuat log lama; periksa timestamp entri terbaru.
6. Buka aplikasi di kedua browser, tekan Ctrl+Shift+R, lalu jalankan sync manual. Ulangi edit independen serta konflik pada satu akun uji. Konflik revisi yang sesekali muncul sebagai `PT409` di log wajar; request harus kembali dan client membaca ulang. Konflik isi tetap meminta pilihan pengguna.

Salinan definisi RPC menyediakan jalur pemulihan fungsi bila upgrade perlu dibatalkan. Hentikan sync dan proses terkait sebelum pemulihan terkontrol; definisi lama dengan `40001` akan membawa kembali bug jika diaktifkan untuk layanan berjalan. Jangan memundurkan revision atau menghapus data/pending untuk membatalkan perubahan fungsi. Agent belum menerapkan migrasi atau menghentikan backend pada proyek hosted pengguna.

## 2. Konfigurasi aplikasi

Buat `.env` dari [.env.example](../.env.example) **hanya jika belum ada**. Isi nilai milik proyek Anda:

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_PUBLISHABLE_OR_ANON_KEY
VITE_CONTACT_EMAIL=alamat-kontak-anda
```

URL/key di atas placeholder. Gunakan public publishable/anon key. Semua `VITE_*` masuk bundle browser: jangan gunakan secret/service-role key, password database atau token sesi. Kepemilikan data dijaga oleh auth, [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), constraint dan RPC.

Restart dev server setelah env berubah. Pada hosting statis, isi env saat build lalu build ulang; perubahan env tidak mengubah aset yang sudah dibangun.

## 3. Email dan password

Di Supabase Auth, pastikan provider Email dan pendaftaran sesuai kebutuhan. Tentukan kewajiban verifikasi email; verifikasi direkomendasikan sebelum penggunaan rutin. Aturan password server perlu selaras dengan UI yang meminta minimal delapan karakter saat daftar/reset.

Atur Site URL sesuai origin aplikasi. Daftarkan callback konfirmasi dan pemulihan; contoh untuk dev server pada port 5173:

```text
http://localhost:5173/?auth=confirm
http://localhost:5173/?auth=recovery
```

Gunakan host/port/path aktual bila berbeda. Tambahkan versi `127.0.0.1` hanya jika host itu dipakai. Saat deploy, tambahkan URL hosting yang tepat; kode membentuk callback dari `origin + pathname` dengan query di atas. SDK memproses callback sebelum navigasi hash.

Daftar, login, lupa password dan password baru ditangani Supabase Auth. Password tidak masuk tabel keuangan atau cadangan; SDK mempersist sesi agar login dapat dipulihkan. Verifikasi pengiriman email pada konfigurasi layanan yang dipakai. Lihat [auth password](https://supabase.com/docs/guides/auth/passwords) dan [redirect URL](https://supabase.com/docs/guides/auth/redirect-urls).

Provider dapat menyamarkan pendaftaran email yang sudah terdaftar dengan respons tanpa error; itu bukan bukti akun baru dibuat atau email dikirim lagi. Form menampilkan pesan bersyarat lalu kembali ke login dengan email tetap terisi. Lihat [kontrak signup Supabase](https://supabase.com/docs/reference/javascript/auth-signup). Password pendek saat daftar/recovery ditampilkan melalui pesan aplikasi; aturan server tetap berlaku.

## 4. Uji koneksi nyata

Jalankan [daftar penerimaan cloud](VALIDATION.md#penerimaan-cloud-dan-deployment), termasuk email, pemisahan pengguna, dua perangkat, konflik, impor dan offline/reconnect. Gunakan data sintetis dan catat hasil/target tanpa kredensial.

Login tidak memindahkan data tamu otomatis. Gunakan **Impor data tamu** bila data itu perlu masuk workspace pengguna. Akun cloud baru menunggu pembacaan awal sebelum penawaran template; pesan error sync perlu diselesaikan, bukan dipaksa dengan reset/penghapusan pending.

## 5. Deploy untuk pengujian

Source lokal dapat diterapkan sebagai deployment pengujian/beta sesudah pemeriksaan di VALIDATION lulus. Kesiapan produksi tetap memerlukan pembuktian auth/email/recovery pada URL hosting, sync dan pemisahan owner pada layanan nyata, serta pemulihan cadangan cloud. Bukti tes tiruan tidak menggantikan pemeriksaan tersebut. Nomor versi aplikasi bukan penentu kelulusan operasional.

1. Pastikan perubahan sudah disimpan dalam Git dan pemeriksaan di VALIDATION lulus. Simpan ekspor/selesaikan sync sebelum berpindah origin. Tentukan hosting statis dan URL HTTPS tetap; publikasi belum dilakukan oleh agent.
2. Untuk deploy melalui Git, buat repository remote milik Anda, hubungkan remote itu, lalu push branch `main`. Git lokal tidak otomatis membuat repository GitHub atau mempublikasikan kode. Pilih visibilitas repository dengan sengaja.
3. Impor repository pada hosting. Gunakan root proyek, Node 26 (atau versi yang didukung `package.json`), instalasi `npm ci`, build `npm run build`, dan direktori hasil `dist`. Aplikasi memakai router hash; navigasi aplikasi berada setelah `#`.
4. Isi `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` dan, bila diperlukan, `VITE_CONTACT_EMAIL` pada pengaturan environment build hosting. Gunakan nilai proyek yang sudah disiapkan, bukan placeholder. Jangan mengunggah `.env` atau memakai service-role/secret key. Jalankan build/deploy ulang setiap kali env berubah.
5. Tetapkan domain HTTPS final. Di Supabase Auth, atur Site URL ke origin tersebut dan izinkan callback `https://DOMAIN/?auth=confirm` serta `https://DOMAIN/?auth=recovery`, dengan path aktual bila aplikasi tidak berada di root. Pertahankan localhost hanya selama masih digunakan untuk pengembangan.
6. Buka hasil deploy dan muat ulang halaman Pengaturan/Transaksi. Uji daftar-konfirmasi-login, email pemulihan/password baru, dua akun yang terpisah dan sync dua browser dengan data sintetis. Lanjutkan checklist cloud di VALIDATION, termasuk konflik, offline/reconnect dan pemulihan cadangan.
7. Verifikasi data sudah masuk dengan benar sebelum pemakaian rutin. Simpan versi source/commit dan URL yang diuji. Jika frontend gagal, deploy ulang commit/build sebelumnya pada env yang sama; jangan memundurkan revision database atau menghapus storage untuk membatalkan frontend.

`npm run preview` hanya menyajikan build lokal, bukan server produksi. Lihat [deployment Vite](https://vite.dev/guide/static-deploy) dan [env saat build](https://vite.dev/guide/env-and-mode).

### Jalur yang disarankan: Cloudflare Pages

Fisku hanya memerlukan hosting aset statis; Supabase tetap menangani auth/database. Karena itu Cloudflare Pages merupakan rekomendasi yang sesuai. Permintaan aset statis gratis dan tidak dibatasi jumlah request, sedangkan build dan layanan Functions memiliki batas tersendiri. Periksa [harga resmi](https://developers.cloudflare.com/pages/functions/pricing/) dan [batas Pages](https://developers.cloudflare.com/pages/platform/limits/) sebelum memilih paket; rekomendasi ini bukan publikasi atau keputusan hosting yang sudah dilakukan pengguna.

1. Buat repository GitHub/GitLab kosong, tanpa README awal, lalu hubungkan Git lokal. Ganti URL contoh berikut dengan repository milik Anda:

   ```powershell
   git remote add origin https://github.com/USERNAME/fisku.git
   git push -u origin main
   ```

2. Ikuti [Git integration Pages](https://developers.cloudflare.com/pages/get-started/git-integration/), pilih repository tersebut dan production branch `main`. Gunakan produk **Pages** untuk jalur ini; tidak diperlukan kode Workers/Functions.
3. Root adalah root repository, build command `npm run build`, output `dist`. Tetapkan `NODE_VERSION` ke versi yang didukung package.json, misalnya `26`, dan masukkan env public yang dijelaskan di atas ke environment build Production. Preview memakai konfigurasi terpisah bila diaktifkan.
4. Deploy, lalu gunakan alamat `PROJECT.pages.dev` yang diberikan sebagai origin awal. Custom domain tidak diperlukan untuk pengujian awal. Sesuaikan Site URL dan callback Supabase dengan origin yang benar-benar dipakai, lalu jalankan pemeriksaan penerimaan.
5. Push berikutnya ke `main` akan memicu build/deploy melalui integrasi Git. Sebelum push, periksa perubahan dan jalankan verifikasi relevan; remote dan deployment tidak dilakukan otomatis oleh agent.

Ekspor data lokal sebelum berpindah origin. Storage localhost dan domain hosting terpisah; guest tidak pindah otomatis. Gunakan impor di origin tujuan atau sync workspace pengguna yang sama. Jika URL berubah, verifikasi kembali callback dan perpindahan data.

## Cadangan, perubahan schema, dan pemulihan

Cadangan browser serta ekspor dijelaskan di [panduan impor](IMPORT_GUIDE.md#cadangan-dan-pemulihan). Ekspor berkala ke lokasi di luar browser. Untuk cloud, gunakan fasilitas backup/ekspor yang tersedia pada proyek dan buktikan restore ke target pengujian terpisah.

Sebelum migrasi database terpakai, ambil salinan, uji migrasi pada fixture/salinan, periksa constraint, izin/RLS, revision, relasi dan saldo, serta siapkan jalur pemulihan. Sesuaikan pengulangan migrasi dengan ledger/tooling yang digunakan; jangan menjalankan bootstrap ulang.

Restore yang memundurkan revision server memerlukan rekonsiliasi client secara terkontrol. Ekspor keadaan lokal terlebih dahulu, catat perubahan sejak backup, dan periksa baseline/pending sebelum melanjutkan sync. Jangan menghapus pending atau menimpa database terbaru untuk memaksakan status sukses.
