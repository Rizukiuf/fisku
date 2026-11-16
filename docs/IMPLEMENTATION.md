# Arsitektur Fisku

Acuan implementasi yang berlaku. Untuk operasi pengguna lihat [impor](IMPORT_GUIDE.md) dan [setup cloud](SUPABASE_SETUP.md); untuk bukti dan batas uji lihat [VALIDATION.md](VALIDATION.md).

## Stack dan batas desain

React/TypeScript, Vite, Tailwind CSS, IndexedDB, serta Supabase Auth/PostgreSQL opsional. Versi dependency dan Node mengikuti `package.json` dan lockfile. Navigasi memakai hash dan History API. Tidak ada server Node khusus, service worker, atau manifest PWA.

Desain local-first menyimpan perubahan sebelum mencoba sinkronisasi. Cloud memakai **snapshot lengkap per owner dengan revision server dan compare-and-swap (CAS)**. Bentuk ini menjaga transaksi beberapa entitas tetap sederhana, dengan biaya transfer/penulisan sebanding ukuran dataset. Protokol tidak memakai cursor maksimum `updatedAt` atau pemilihan pemenang berdasarkan jam perangkat.

## Peta kode

| Bagian | Modul |
| --- | --- |
| Model, validasi, saldo dan statistik | `src/lib/model.ts` |
| IndexedDB, transaksi dan cadangan | `repository.ts`, `backupPolicy.ts` di `src/lib/` |
| Command, workspace dan publikasi state | `src/lib/financeStore.ts`; facade publik `store.ts` |
| Reset, template dan metadata penyiapan | `reset.ts`, `setup.ts`, `onboarding.ts` di `src/lib/` |
| Pemulihan massal Sampah | `src/lib/restore.ts`; command di `financeStore.ts`, UI `TrashSection.tsx` |
| Validasi/Replace/pemulihan impor | `src/lib/imports.ts` |
| Planner Merge, review dan alias | `mergeImport.ts`, `mergeTransactions.ts`, `mergeTypes.ts`, `importAliases.ts` di `src/lib/` |
| Dialog impor file/guest | `src/lib/importConfirm.ts`, `src/components/ImportDialog.tsx`, `ImportMergeReview.tsx` |
| Sinkronisasi, deadline dan penggabungan tiga arah | `sync.ts`, `syncEngine.ts`, `syncDeadline.ts`, `reconcile.ts` di `src/lib/` |
| Perbandingan isi konflik | `src/lib/conflictDetails.ts`, `src/components/ConflictDetails.tsx` |
| Auth dan lifecycle sesi | `src/lib/supabase.ts`, `src/hooks/useSession.ts` |
| Pemicu/status sync | `src/hooks/useAutoSync.ts`, `useSync.ts`, `src/lib/syncStatus.ts` |
| Ketersediaan impor tamu dan fingerprint sumber | `src/hooks/useGuestImport.ts`, `src/lib/guestImport.ts` |
| Banner lintas halaman dan tindakan langsung | `src/components/WorkspaceNotice.tsx`, `src/App.tsx`; indikator `src/components/SyncStatus.tsx` dan `SyncProgress.tsx` |
| Form nominal, parser dan kursor | `src/lib/format.ts`, `amountInput.ts` |
| Dialog/toast dan operasi async UI | `src/lib/ui.ts` |
| Bahasa UI dan pesan | `src/lib/translations.ts` (katalog murni), `messages.ts` (pesan terkontrol), `i18n.ts` (hook) |
| Startup, auth, penyiapan, sampah dan cadangan | `StartupPanel.tsx`, `CloudSection.tsx`, `OnboardingDialog.tsx`, `TrashSection.tsx`, `BackupSection.tsx` di `src/components/` |
| Form transaksi dan pembuatan referensi | `src/components/TransactionForm.tsx`, `EntityFormModal.tsx` |
| Schema, constraint, RLS dan RPC | `supabase/migrations/001_init.sql`; upgrade RPC terpakai `002_revision_conflict.sql` di direktori yang sama |

## Model dan validasi

Versi yang tampil di Pengaturan diambil dari `package.json`. Nomor versi aplikasi bukan nomor schema IndexedDB atau revision cloud; mengubah label versi tidak memigrasikan data.

Entitas memiliki UUID, `updatedAt`, dan `deletedAt`. Timestamp menjelaskan perubahan; revision server dan baseline menentukan rekonsiliasi.

| Entitas | Isi dan aturan |
| --- | --- |
| Akun | Nama, jenis cash/bank/ewallet/credit, saldo awal; saldo dihitung dari transaksi |
| Kategori | Nama dan jenis income/expense |
| Transaksi | Akun, jenis, nominal, tanggal `YYYY-MM-DD`, catatan, kategori atau akun tujuan transfer |
| Anggaran | Satu row per kategori pengeluaran, termasuk row di Sampah; limit digunakan ulang setiap bulan |
| Preferensi | Tema dan bahasa, lokal per workspace; ikut cadangan/Replace, tidak ikut sync cloud |

Nominal adalah IDR bulat dan safe integer. Saldo awal boleh negatif; nominal transaksi serta limit anggaran aktif positif. Agregasi memakai pemeriksaan presisi untuk menolak overflow. Format ribuan menyesuaikan saat mengetik sambil menjaga kursor. Nilai dan seleksi input diperbarui pada event yang sama agar pemulihan kursor tidak menimpa seleksi atau ketikan berikutnya. Desimal atau input tempelan invalid tidak diubah diam-diam menjadi nominal lain. Tanggal transaksi mengikuti tanggal lokal.

Nama ekspor manual memakai `fisku-backup-YYYY-MM-DD.json` dengan tanggal lokal perangkat saat ekspor, selaras dengan tanggal default transaksi. `exportedAt` di JSON tetap timestamp ISO UTC untuk menyatakan waktu absolut; bukan tanggal transaksi terakhir. Nama unduhan cadangan otomatis tetap memakai ID cadangan.

`decodeState()` memeriksa bentuk dan memanggil `validateRelations()`: UUID unik, tidak berbenturan dengan purge, nama akun aktif unik tanpa membedakan kapital/spasi tepi, kategori aktif unik menurut jenis/nama, dan budget unik menurut kategori. Referensi parent harus tersedia; referensi transaksi aktif harus aktif dan sesuai jenis. Transfer memakai dua akun berbeda tanpa kategori; income/expense tidak membawa akun tujuan transfer. Keunikan/relasi diperiksa otomatis, tanpa tombol pemeriksaan manual.

## Penyimpanan dan sesi

Database IndexedDB `fisku.local.v1` memiliki object store `workspaces` dan `backups`. Scope adalah `guest` atau `user:<UUID>`. Workspace menyimpan:

- `state`, `version`, serta `schema`.
- `base` sebagai snapshot server terakhir yang diakui, `revision`, `pending`, `lastSync`, dan `conflict`.
- Metadata lokal opsional `onboarding`, `importIds`, `mergeIds`, dan `guestImport`.

State, metadata dan cadangan ditulis dalam satu transaksi. UI dipublikasikan sesudah commit; kegagalan membatalkan seluruh perubahan. Transaksi read-modify-write mencegah lost update lintas tab; BroadcastChannel mengabarkan hasil commit. Editor memeriksa row yang dibuka agar draft lama tidak menimpa perubahan baru.

Auth mengganti workspace dengan guard scope/generation dan mengosongkan tampilan owner sebelumnya selama pemuatan. Login tidak mengadopsi data tamu otomatis. Preferensi, cadangan, alias dan keputusan penyiapan terpisah per workspace. Auth SDK mengelola persistensi dan refresh sesi; password tidak disimpan dalam data keuangan.

Form auth memakai validasi aplikasi untuk email wajib/format, password wajib, minimal delapan karakter saat daftar/recovery dan kecocokan konfirmasi. Validasi native browser tidak menampilkan bubble terpisah. Login tidak memaksakan minimum pendaftaran pada password akun yang sudah ada. Setelah respons signup tanpa sesi, form kembali ke login dengan email dipertahankan dan password dikosongkan. Pesan bersyarat tidak mengklaim akun baru atau pengiriman email pasti terjadi, karena provider dapat menyamarkan respons email yang sudah terdaftar.

Saat workspace guest pertama dibuat, repository dapat membaca `finance.v3`/`finance.v2` dari localStorage jika tersedia dan valid. Sumber mentah tidak ditimpa; data invalid menghasilkan panel pemulihan. Ini jalur kompatibilitas input, bukan penyimpanan aktif aplikasi.

## Sinkronisasi cloud

1. Jika ada snapshot pending, kirim ulang dengan ID operasi yang sama sebelum membaca server. Pending sudah durable sebelum request jaringan.
2. Server memeriksa owner, ID operasi dan expected revision. Retry setelah respons hilang mengakui operasi yang sama; penolakan CAS memakai SQLSTATE `PT409`/HTTP 409 dan memicu pembacaan ulang. Jangan memakai `40001` untuk konflik aplikasi karena PostgREST dapat mengulang transaksi yang sama di server. Client masih mengenali respons legacy `40001` yang benar-benar kembali, tetapi kompatibilitas ini tidak menghentikan loop server lama.
3. Client membaca satu snapshot lengkap beserta revision melalui `finance_read()`, lalu merekonsiliasi baseline, lokal terkini dan remote.
4. Perubahan yang tidak bertentangan digabung. Konflik menyimpan kedua snapshot sebagai cadangan dan meminta keputusan eksplisit. Konflik relasi dapat memerlukan pemilihan dataset lengkap.
5. Bila masih ada selisih terhadap remote, client menyimpan pending baru dan mengirim melalui `finance_push()`. Pengakuan snapshot lama memperbarui baseline tanpa membuang edit lokal yang terjadi selama request.

Token request ditangkap untuk owner awal. Worker dan penerapan respons memeriksa scope/generation; hasil sesi lama tidak diterapkan ke pengguna baru. `withSyncDeadline()` membatasi tahap async 15 detik dan seluruh percobaan 30 detik. Race deadline mencakup getSession/getUser, RPC dan penyimpanan, bukan hanya fetch: wrapper SDK dapat menunggu sesi sebelum request mulai dan sebelum AbortSignal mencapai jaringan. Error timeout menyebut tahap yang tertahan.

Deadline membatalkan signal request dan memagari kelanjutan percobaan yang kedaluwarsa. Callback transaksi lokal memeriksa deadline serta owner sebelum menerapkan hasil; commit yang baru memperoleh slot sesudah timeout ditolak. Transaksi yang sudah lolos pemeriksaan tetap mengikuti commit/rollback atomik repository. Timeout bukan bukti server gagal commit dan bukan alasan membuang pending: retry mempertahankan UUID operasi agar respons hilang tidak menggandakan write.

Panggilan sync yang bertumpuk berbagi satu flight; permintaan ulang dijalankan langsung hanya sesudah sukses dan tanpa konflik. Kegagalan sementara biasa mengikuti backoff auto-sync. `SYNC_TIMEOUT` menjeda seluruh pemicu otomatis, termasuk timer, fokus, reconnect dan edit lokal, sampai pengguna mencoba sync manual; reload sesi/workspace juga menginisialisasi status baru. Ini mencegah rangkaian timeout terlihat sebagai spinner tanpa akhir. Konflik yang sudah tersimpan menolak sync baru sampai keputusan eksplisit. Refresh auth untuk owner yang sama tidak mengubah status/error atau jeda sync; reset status hanya ketika workspace sesi perlu dimuat. Error auth/domain tetap memerlukan penanganan yang sesuai.

Status menyimpan tahap, waktu mulai monotonik dan penanda jeda hanya dalam memori client, terpisah dari data keuangan/pending serta tidak diekspor atau dikirim ke cloud. Pengaturan menampilkan tahap aktif dan detik sejak percobaan dimulai; penghitung diinisialisasi ulang per percobaan. Banner dan keterangan Pengaturan menjelaskan ketika sync otomatis dijeda. Retry manual tetap memakai pending yang sama dan mengaktifkan kembali auto-sync bila berhasil.

Auto-sync dipicu setelah perubahan lokal, saat sesi siap, online/focus/visibility, dan pemeriksaan berkala. Timestamp `lastSync` adalah metadata status, bukan pengganti pemeriksaan pending atau revision.

PostgreSQL tetap memakai tabel relasional. Composite key/FK mencakup owner; constraint, validasi snapshot dan RLS menjaga data lintas pengguna. Role aplikasi membaca sesuai RLS dan menulis melalui RPC, bukan upsert langsung. RPC mengunci revision dan commit snapshot secara atomik. Identitas lama yang tidak ada pada snapshot harus tetap dipertanggungjawabkan melalui tombstone atau marker purge.

Database terpakai memerlukan migrasi `002_revision_conflict.sql` untuk mengganti kode CAS tanpa mengubah data, revision, ledger atau izin. Seluruh client harus memakai kontrak terbaru. Proses PostgREST yang sudah berulang dapat memerlukan penghentian terpisah; langkah penerapan/pemulihan ada di [panduan Supabase](SUPABASE_SETUP.md#database-terpakai-perbaikan-konflik-revisi). Satu percobaan mesin sync dibatasi delapan iterasi, selain deadline client; pembatasan client tidak mengendalikan retry transaksi di dalam server.

## Impor dan pemetaan identitas

Kontrak pengguna ada di [IMPORT_GUIDE.md](IMPORT_GUIDE.md). `prepareImportReview()` memvalidasi sumber, mengambil snapshot workspace dan mengalokasikan UUID stabil tanpa menulis. `buildMergePlan()` adalah planner murni. `commitImportReview()` memeriksa kembali sesi, konflik, isi state, dan kedua cache pemetaan di dalam transaksi sebelum menyimpan hasil beserta cadangan.

Perubahan isi/alias membatalkan review; heartbeat checkpoint/version/timestamp saja tidak. Kandidat invalid atau keputusan tertunda menolak commit. Pending, baseline dan revision sync tidak direset.

`mergeIds` menyimpan alias UUID per jenis dan mendukung many-to-one yang dipilih melalui review. `importIds` menyimpan pemetaan graph pemulihan Replace; reuse yang tidak valid memicu salinan graph baru. Keduanya lokal per owner, divalidasi saat baca/tulis, dan tidak masuk ekspor, cadangan finansial atau RPC. Identitas asli dan salinan yang hadir bersamaan pada sumber transaksi diperlakukan berbeda.

Dialog file memilih Merge secara awal dan menyediakan Replace. Impor guest hanya Merge, ditegakkan pada dialog, commit review dan API `actions.importGuest()`. API file `actions.importJSON()` tanpa mode tetap memakai Replace untuk kompatibilitas; pemanggil programatik sebaiknya menyebut mode secara eksplisit. Mode invalid atau keputusan Merge yang belum lengkap ditolak.

`workspace.guestImport` adalah receipt SHA-256 lokal untuk isi finansial guest aktif, dengan urutan stabil serta tanpa preferensi, Sampah, purge atau `updatedAt`. Receipt ditulis bersama hasil Merge, alias dan cadangan dalam transaksi yang sama, tidak ikut ekspor/cloud. Sumber guest tetap disimpan. Tombol disembunyikan untuk sumber kosong, sumber yang sudah ditinjau atau rencana tanpa perubahan; perubahan sumber membuatnya dapat ditawarkan kembali. Metadata selesai tetap terpisah antar-user. Hook memeriksa hasil async menurut sesi/urutan dan memantau notifikasi guest lintas tab/focus. Sumber review dipin: bila guest berubah selama review, commit sumber lama tidak menandai sumber baru sebagai selesai. Perubahan receipt juga membatalkan pratinjau target yang kedaluwarsa.

## Pemberitahuan data

`WorkspaceNotice` tampil di kontainer halaman tanpa modal otomatis. Prioritasnya: konflik, offline dengan perubahan tertunda, kegagalan sync, kegagalan pemeriksaan guest, lalu sumber guest yang perlu ditinjau. Konflik memakai keterangan sederhana dan jumlah bagian, sementara ID teknis tetap tersedia di Pengaturan. Tindakan konflik/detail membuka Pengaturan, memfokuskan bagian cloud dan menggulirkannya ke tampilan. Retry memanggil jalur sync yang sama; tidak mengubah pending atau memaksakan sukses.

Pengaturan menampilkan nama entitas dan tabel bagian yang berbeda antara data akun lokal terkini dan snapshot cloud yang tersimpan saat konflik ditemukan. Referensi akun/kategori diterjemahkan dari snapshot masing-masing; nominal, tanggal, catatan dan status aktif/Sampah/purge ditampilkan sesuai jenisnya. `updatedAt` tidak dianggap perbedaan isi. ID berada dalam detail teknis tertutup. Builder memakai baseline serta `reconcileWithDetails()` untuk menganalisis kedua pilihan dengan aturan resolver yang sama: edit baru dapat menambah konflik, dan konflik row biasa dapat menyebabkan fallback dataset karena child terkait. Jika salah satu pilihan memerlukan dataset lengkap, seluruh graph yang berbeda ditampilkan beserta penjelasannya; ID lama/tidak dikenal juga ditangani secara konservatif. Builder murni memakai data yang sudah tersedia, tanpa request tambahan atau perubahan penyimpanan; hasil dimemoisasi, tabel dipaginasi dan teks panjang dapat digulir.

Pilihan lokal/cloud tetap menyelesaikan seluruh bagian yang konflik melalui rekonsiliasi yang sama. UI menangkap scope, generasi sesi, isi lokal, baseline dan snapshot konflik sebelum dialog konfirmasi. `resolveSyncConflict()` memeriksa ulang semuanya dalam transaksi; perubahan isi/baseline/revisi/sesi membatalkan pilihan lama agar pengguna meninjau perbandingan terbaru. Heartbeat metadata atau preferensi saja tidak membatalkan pilihan finansial.

Banner gagal sync memakai error tersimpan selain status, sehingga edit baru yang mengubah status menjadi idle tidak menghilangkan kegagalan. Selama retry berjalan, indikator ringan menunjukkan proses; jika gagal lagi, banner kembali. Pending normal tidak menghasilkan banner tambahan. Indikator membedakan konflik dari kegagalan umum, dan pending akun dari keadaan sudah tersinkron.

Tinjau data tamu membuka dialog Merge bersama yang juga digunakan Pengaturan. Nanti hanya menyimpan penundaan dalam memori untuk owner, generasi sesi dan fingerprint sumber pada kunjungan itu; tidak menulis receipt impor, state finansial atau cadangan. Navigasi halaman mempertahankan penundaan, sedangkan sumber berubah, sesi baru atau reload dapat menawarkan banner lagi. Tombol impor di Pengaturan tetap tersedia. Pemulihan password dan sesi yang belum siap tidak menampilkan banner akun.

## Penyiapan, reset, dan form

Workspace baru kosong. Metadata `onboarding` memakai `pending`, `template`, `empty`, atau `existing`. Pilihan template menambahkan tiga akun bersaldo nol dan tujuh kategori secara atomik; pilihan kosong hanya menulis metadata. Penundaan dialog tidak menulis pilihan. Tombstone, purge, baseline, pending/conflict dan revision juga menjadi bukti workspace sudah digunakan.

Scope user menunggu pembacaan cloud awal pada sesi aktif sebelum menawarkan penyiapan/template; recovery password didahulukan. Template manual hanya tersedia ketika semua entitas aktif kosong dan tidak ada konflik. ID template yang sudah terpakai atau purged diganti UUID baru.

Reset menandai data aktif sebagai tombstone, mempertahankan payload historis, preferensi, Sampah dan purge. Reset tidak membuat template atau mengulang dialog awal. Jika sudah kosong, tidak ada cadangan atau perubahan finansial; penyiapan yang masih pending diselesaikan sekali lewat metadata.

Form transaksi dapat dibuka tanpa akun/kategori. Simpan menunggu referensi valid; pembuatan referensi memakai modal terpisah dan mempertahankan draft. Referensi yang dihapus di tab lain harus dipilih ulang. Penambahan referensi dari tab lain tidak otomatis dipilih; editor transaksi terhapus diblokir.

## Sampah, purge, dan cadangan

Hapus biasa memakai `deletedAt`; penghapusan parent menandai child terkait dalam transaksi yang sama. Restore bersifat eksplisit dan memeriksa relasi. Purge menghapus payload lokal dan menyimpan marker UUID per jenis; parent dengan child tersisa tidak dapat dimusnahkan. Marker dipertahankan agar perangkat lama tidak menghidupkan ID tersebut kembali. Penghapusan cloud perlu sync berhasil.

**Pulihkan semua** memakai planner murni: akun/kategori lebih dulu, kemudian transaksi, transfer dan anggaran yang memenuhi syarat. Semua kandidat dengan nama aktif yang sudah dipakai atau beberapa tombstone bernama sama dilewati secara konservatif; tidak ada pencocokan/merge atau pemenang menurut urutan. Kategori tetap membedakan jenis. Child yang parent-nya belum aktif dan anggaran dengan limit tidak positif tetap di Sampah. UI melaporkan jumlah dipulihkan/dilewati serta alasan; tidak menghilangkan payload atau marker purge.

Command menangkap scope/generation dan isi data sebelum konfirmasi, lalu memeriksanya lagi di transaksi. Heartbeat atau preferensi saja tidak membatalkan pilihan. Hasil kandidat melewati validasi domain penuh; benturan/overflow yang masih tersisa atau kegagalan write membatalkan keseluruhan commit. Satu cadangan `before-restore-all` dibuat bersama perubahan hanya bila ada yang dipulihkan. No-op tidak menulis state/cadangan baru. Pending/baseline/cache/receipt dan preferensi dipertahankan; hasil mengikuti sync biasa. Pemulihan tidak berfungsi sebagai perbaikan dataset yang sudah rusak.

Cadangan pra-impor/Replace/reset disimpan hanya jika isi finansial/preferensi berubah; perubahan `updatedAt` saja bukan perubahan isi. Retensi memakai urutan commit, deduplikasi isi dan batas lima cadangan normal per workspace. Snapshot konflik lokal/cloud memiliki kelompok perlindungan selama konflik belum selesai, lalu mengikuti retensi normal.

Unduh/hapus satu/semua cadangan normal tersedia di Pengaturan, dengan konfirmasi dan guard sesi. Penghapusan cadangan tidak mengubah state, Sampah atau pending. Cadangan dan purge tidak menghapus salinan ekspor eksternal. Cadangan lokal tidak disinkronkan.

## Bahasa antarmuka

Bahasa Indonesia/Inggris mengikuti preferensi per workspace. Katalog key dan pesan terkontrol terpisah dari domain; hook menerjemahkan label, indikator/tahap sync, dialog/toast, validasi, error aplikasi, dan beberapa pesan auth/database yang dikenali saat ditampilkan. Pesan asli dan kode error programatik tetap utuh. Toast/dialog yang masih terbuka dapat mengikuti pergantian bahasa; teks teknis eksternal yang tidak dikenali dipertahankan agar diagnosis tidak hilang.

Nama akun/kategori, catatan dan data keuangan tidak diterjemahkan atau ditulis ulang saat bahasa berubah. Format tanggal/nominal tampilan serta nama bulan grafik memakai locale pilihan; tanggal input/ekspor tetap mengikuti zona waktu perangkat dan timestamp penyimpanan tetap UTC. Layar startup memakai bahasa browser yang didukung sebelum preferensi dapat dibaca; setelah workspace siap, preferensi workspace berlaku. Fallback tersebut tidak membuat preferensi global atau mengadopsi preferensi pengguna lain.

## Batas operasional

- Penghapusan/kehabisan storage browser juga memengaruhi cadangan lokal. Ekspor ke lokasi lain tetap diperlukan.
- Offline berlaku saat aplikasi terbuka, bukan cold-start tanpa jaringan. Sesi akun yang tidak dapat dipulihkan perlu autentikasi kembali untuk membuka workspace akun.
- Tanpa BroadcastChannel, transaksi tetap aman tetapi perubahan tab lain perlu dimuat ulang untuk terlihat.
- Snapshot lengkap mempunyai biaya sebanding dataset. Batas HTTP, timeout dan performa dataset sangat besar harus diukur pada target nyata sebelum mengubah protokol.
- Impor hanya menerima cadangan/state yang lolos validasi; tidak ada konversi CSV bank, rekonstruksi file rusak, fuzzy nama atau inferensi jam transaksi.
- Migrasi awal hanya untuk database baru. Upgrade database terpakai memerlukan migrasi lanjutan dan jalur pemulihan.
