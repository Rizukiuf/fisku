# Panduan impor dan cadangan

Berlaku untuk JSON cadangan Fisku dan **Impor data tamu**. File dapat berasal dari perangkat yang sama atau pencatatan terpisah di perangkat lain. Data tamu berasal dari penyimpanan browser/origin yang sedang digunakan.

## Pilih Merge atau Replace

Pilihan dua mode berlaku pada impor file. **Impor data tamu hanya menggunakan Merge** agar penyalinan data tamu tidak mengganti seluruh isi akun. Untuk mengganti dataset, gunakan impor file cadangan dengan pratinjau Replace.

| Mode | Data lokal yang tidak ada pada sumber | Preferensi | Penghapusan dari sumber |
| --- | --- | --- | --- |
| **Gabungkan (Merge)** — default dialog | Tetap ada | Tetap lokal | Row Sampah dan marker purge sumber diabaikan |
| **Ganti (Replace)** | Umumnya menjadi Sampah agar penghapusan tetap tersinkron | Mengikuti sumber | Mengikuti snapshot dan menggabungkan marker purge dengan marker lokal |

Replace mempertahankan identitas yang masih sah. Jika sumber memuat ID yang telah dimusnahkan lokal, tersedia **Pulihkan sebagai data baru**: seluruh graph disalin ke ID aman atau memakai kembali salinan pemulihan yang masih sah. Marker lokal dipertahankan; marker file tidak diterapkan ke identitas lokal pada mode salinan tersebut.

## Urutan penggunaan

1. Pilih file atau Impor data tamu. Format, nominal, tanggal, ID dan relasi diperiksa sebelum review. Data tamu diambil sebagai snapshot; perubahan berikutnya tidak mengganti sumber dialog secara diam-diam.
2. Pada impor file, pilih mode. Periksa jumlah data sebelum/sesudah, jumlah baru/diubah dan total saldo. Angka sesudah masih sementara selama ada keputusan tertunda.
3. Pada Merge, selesaikan pemetaan akun/kategori, konflik saldo/anggaran dan transaksi. Simpan nonaktif jika ada hasil invalid, keputusan tertunda, konflik sync atau pratinjau kedaluwarsa.
4. Simpan hasil. Data, cache pemetaan dan cadangan pra-perubahan ditulis dalam satu transaksi lokal. Sukses ditampilkan setelah commit.

Batal, Escape dan backdrop sebelum penyimpanan tidak mengubah data atau membuat cadangan. Saat commit, penutupan ditahan agar status jelas. Kegagalan write/quota membatalkan perubahan dan menampilkan error di dialog.

## Pemetaan akun dan kategori

Pencocokan memakai identitas/alias yang masih sesuai, lalu nama dengan spasi tepi dihapus dan huruf kecil beserta jenisnya. ` BCA ` dan `bca` dapat cocok; `BCA` dan `BCA Tabungan` tidak otomatis disamakan. Tidak ada fuzzy matching.

Pemetaan terlihat dan dapat diganti:

- **Tujuan lokal:** arahkan transaksi/anggaran sumber ke akun/kategori tersebut; nama dan jenis lokal dipertahankan.
- **Buat salinan baru:** gunakan ID aman dan nama yang tidak berbenturan dengan aturan keunikan.
- **Lewati beserta data terkait:** jangan masukkan entitas sumber dan dependennya. Ini tidak menghapus data lokal dan hanya berlaku pada impor tersebut.

Jenis akun menentukan pencocokan otomatis; tujuan akun berbeda jenis masih dapat dipilih secara eksplisit dengan mempertahankan jenis lokal. Kategori hanya dapat dipetakan ke jenis income/expense yang sama. ID dikenal dengan nama/jenis tidak sesuai memerlukan keputusan eksplisit.

Semua referensi sumber mengikuti pemetaan, termasuk akun tujuan transfer dan kategori anggaran. Jika pemetaan membuat kedua akun transfer sama, ubah pemetaan atau lewati transfer itu.

Contoh identitas: akun lokal ber-ID **A**, akun sumber ber-ID **B**. Jika B dipetakan ke A, akun B tidak dibuat terpisah, referensinya diarahkan ke A, dan cache lokal menyimpan **B → A**. B tidak otomatis menjadi `purged`. Merge tidak menghapus row lokal aktif yang sudah ada hanya karena pemetaan sumber.

## Saldo awal dan anggaran

**Saldo awal tidak dijumlahkan.** Jika lokal Rp100.000 dan sumber Rp200.000 untuk tujuan akun yang sama, pilih salah satunya. Transaksi terpilih kemudian dihitung terhadap saldo awal itu. Beberapa akun sumber menuju satu akun lokal menghasilkan satu keputusan nilai per tujuan, bukan penimpaan menurut urutan file.

**Limit anggaran tidak dijumlahkan.** Pilih nilai lokal atau salah satu sumber bila berbeda. Satu kategori tetap memiliki satu row anggaran. Jika budget lokal berada di Sampah, memilih sumber memulihkannya secara eksplisit; memilih lokal mempertahankan keadaan lokal. ID purged tetap tidak dipakai ulang.

Pilihan massal mempertahankan nilai lokal tersedia bagi konflik yang memiliki nilai lokal. Setiap keputusan masih dapat diubah sebelum commit.

## Review transaksi

| Kondisi setelah pemetaan referensi | Perilaku |
| --- | --- |
| ID/alias dikenal dan seluruh rincian sama | Tidak ditambahkan lagi |
| ID/alias dikenal tetapi rincian berbeda | Pilih lokal, sumber, transaksi terpisah atau lewati |
| ID berbeda tetapi jenis, nominal, tanggal, akun, kategori/tujuan serupa | Kandidat duplikat yang perlu diputuskan |
| Transaksi baru tanpa kandidat lokal | Ditambahkan secara awal; dapat dilewati |
| Parent sumber dilewati | Transaksi sumber terkait dilewati |

Kesamaan isi identitas mencakup catatan. Saran kemiripan memakai jenis/nominal/tanggal/referensi; catatan ditampilkan untuk dibandingkan. Timestamp pembaruan tidak memilih pemenang. Tanggal hanya menyimpan hari tanpa jam, sehingga dua pembelian pada hari yang sama dapat sama-sama sah.

Untuk kandidat, **Sama dengan transaksi lokal** mempertahankan row lokal dan mencatat alias sumber ke row tersebut. **Tambahkan sebagai transaksi terpisah** mempertahankan keduanya. Pilihan massal menambah kandidat sebagai transaksi terpisah juga tersedia secara eksplisit.

Dua transaksi baru dengan ID berbeda dalam satu file tetap dua row sekalipun rinciannya identik. Daftar review memakai 25 row per halaman, dengan filter semua atau yang masih perlu diputuskan.

## Sampah, purge, dan impor ulang

Hapus biasa mempertahankan payload dengan `deletedAt` di Sampah. Pemulihan memeriksa parent dan jenis relasinya. Musnahkan menghapus payload dan mencatat UUID dalam `purged` menurut jenis data untuk mencegah perangkat lama mengirim kembali identitas tersebut. Nama boleh dipakai lagi dengan ID baru.

Pada Merge, data sumber aktif yang memakai ID lokal terhapus/purged dan belum memiliki alias pemulihan aktif yang sah memerlukan keputusan pemulihan/pemetaan/lewati. Pemulihan massal tidak menghilangkan kewajiban review jika transaksi itu juga memiliki kandidat mirip. ID purged tidak digunakan ulang.

Cache alias tersimpan lokal per workspace, tidak ikut ekspor, cadangan finansial atau cloud. Sumber yang dikenali dapat diimpor ulang tanpa menggandakan transaksi yang sama; konflik nilai yang masih berbeda tetap perlu keputusan. Perangkat lain tanpa cache dapat meminta review lagi.

Jika ekspor memuat transaksi asli dan salinannya, keduanya tetap berbeda. Impor file asal yang hanya memuat identitas awal masih dapat mengenali salinannya. Target alias yang sudah terhapus/purged tidak dianggap aktif.

## Pratinjau dan sinkronisasi

Pada review Merge, **lokal** berarti data workspace tujuan yang sedang dibuka, termasuk hasil sync cloud dan perubahan lokal yang belum terkirim. Saat impor tamu setelah login, tujuan ini adalah data akun yang sedang login, bukan workspace guest. **Sumber** berarti snapshot yang diimpor: data tamu pada jalur impor tamu, atau isi file pada impor cadangan. Memilih nilai sumber tidak menjumlahkannya dengan nilai lokal.

Review terikat owner, generasi sesi, isi data dan cache pemetaan. Perubahan dari tab lain atau sync mengharuskan **Perbarui pratinjau**; keputusan lama direset untuk diperiksa kembali. Commit mengulangi guard tersebut dalam transaksi. Heartbeat checkpoint/timestamp tanpa perubahan isi tidak membatalkan review.

Konflik sync harus diselesaikan dahulu. User baru tanpa cache menunggu pembacaan cloud pertama sebelum impor; cache user yang pernah sync mendukung impor saat offline jika aplikasi sudah terbuka. Pending, baseline dan revision tidak direset; hasil impor tersimpan lokal lalu mengikuti protokol sync biasa. Adopsi guest tidak mengubah sumber guest.

## Ketersediaan tombol data tamu

Banner pada halaman aplikasi menawarkan **Tinjau data tamu** untuk membuka review Merge yang sama tanpa mencari Pengaturan. **Nanti** menunda banner hanya untuk kunjungan dan sumber yang sama, tanpa mencatat impor selesai. Tombol di Pengaturan tetap tersedia; sumber berubah, sesi baru atau reload dapat menawarkan banner kembali. Konflik/gagal sync memiliki prioritas pemberitahuan lebih tinggi.

Tombol tersedia saat sudah login dan sumber guest masih perlu digabung/ditinjau. Sumber kosong atau rencana yang tidak mengubah data tidak ditawarkan. Sesudah impor berhasil, receipt isi sumber disimpan lokal per akun sehingga sumber yang sama tidak ditawarkan lagi, termasuk setelah reload atau perubahan data akun.

Receipt tidak berarti sumber guest dihapus atau dipindahkan. Pengguna lain memiliki status terpisah. Bila data guest aktif berubah, tombol dapat muncul lagi; perubahan tema, timestamp atau Sampah/purge saja tidak dianggap sumber baru. Tab lain dipantau melalui notifikasi dan focus. Keputusan lewati dalam review juga termasuk penyelesaian sumber yang ditinjau. Untuk mengulangi sumber yang sama dengan keputusan berbeda, gunakan ekspor guest dan impor file.

Pembatalan atau kegagalan penyimpanan tidak mencatat selesai. Jika guest berubah saat dialog masih terbuka, dialog tetap memakai snapshot yang dipilih dan perubahan berikutnya tetap dapat ditawarkan. Receipt tidak ikut ekspor, cadangan finansial atau cloud.

## Cadangan dan pemulihan

Ekspor memuat data aktif, Sampah, marker purge dan preferensi, tanpa password/token. Formatnya `{ format: 'fisku-backup', version: 1, exportedAt, data }`; format state tanpa pembungkus juga diterima jika lolos validasi. Tidak ada konversi otomatis file rusak atau CSV bank.

Ekspor manual bernama `fisku-backup-YYYY-MM-DD.json`, memakai tanggal lokal perangkat saat tombol ditekan. `exportedAt` di dalam JSON menyimpan saat ekspor sebagai timestamp ISO UTC, bukan tanggal transaksi terakhir. Unduhan cadangan otomatis memakai nama `fisku-recovery-<ID>.json` dan timestamp snapshot cadangannya; mengunduhnya tidak membuat snapshot keuangan baru.

Cadangan pra-impor menyimpan **keadaan lokal sebelum perubahan**, bukan salinan tambahan file sumber yang belum pernah masuk lokal. Impor tanpa perubahan isi finansial/preferensi tidak menambah cadangan normal. Batasnya lima per workspace dengan deduplikasi; salinan konflik belum selesai dilindungi terpisah.

Data di Sampah dapat dipulihkan satu per satu atau melalui **Pulihkan semua**. Pemulihan massal menangani parent lebih dulu, mempertahankan identitas, dan membiarkan data yang belum memenuhi syarat tetap di Sampah dengan alasan yang ditampilkan. Nama yang bentrok tidak digabung otomatis. Cadangan sebelum pemulihan massal dibuat hanya bila ada perubahan; kegagalan simpan/validasi membatalkan seluruh commit. Pemulihan Sampah tidak menggunakan ulang ID purged.

Unduh atau hapus cadangan normal dari Pengaturan. Untuk memulihkan, unduh cadangan lalu impor dengan mode yang sesuai. Purge tidak menghapus ekspor, cadangan lama atau salinan perangkat lain sebelum sync. Simpan ekspor di luar browser agar kehilangan storage situs tidak menghapus semua salinan.

Bukti pengujian dan batasnya tersedia di [VALIDATION.md](VALIDATION.md). Prosedur pemulihan database cloud ada di [SUPABASE_SETUP.md](SUPABASE_SETUP.md).
