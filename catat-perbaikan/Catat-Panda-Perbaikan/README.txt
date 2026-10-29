Catat Panda — paket perbaikan edit transaksi

ISI
- index.html: frontend lengkap, splash screen, edit action, cache versi baru.
- sw.js, manifest.webmanifest, icons/: aset frontend.
- Code.gs: Apps Script yang membaca/menulis transaksi pada tab Form Responses 1.
- test_backend.js: tes lokal untuk memastikan ID transaksi Tally dan ID transaksi baru dapat diedit pada baris yang sama.

SEBELUM MEMASANG
1. Buat salinan/cadangan spreadsheet dan deployment yang sekarang.
2. Di Code.gs, ganti nilai TOKEN dengan token yang sama dengan aplikasi. Jangan kirim atau bagikan token.
3. Pastikan tab Form Responses 1 memiliki header berikut di baris pertama (urutan boleh berbeda):
   Submission ID, Respondent ID, Submitted at, Tanggal Transaksi, Untuk apa?, Kategori, Tipe, Metode Pembayaran, Kebutuhan atau Keinginan?, Jumlah cepat, Jumlah, Nama orang, Hutang atau Piutang?
4. Tab Catatan Harian tetap menjadi tampilan otomatis/formula. Script baru tidak menulis ke tab itu.

PASANG APPS SCRIPT
1. Buka Extensions > Apps Script dari spreadsheet yang benar.
2. Ganti kode server lama dengan isi Code.gs; pastikan TOKEN diisi dengan token yang sudah dipakai aplikasi.
3. Simpan, lalu Deploy > Manage deployments > Edit (ikon pensil) > New version > Deploy.
4. Jika membuat deployment baru, gunakan URL Web App baru di aplikasi. Akses deployment harus Anyone.

PASANG FRONTEND
1. Salin index.html, sw.js, manifest.webmanifest, dan icons/ ke hosting HTTPS aplikasi yang sudah ada.
2. Jangan menghapus file konfigurasi, fungsi Netlify, atau fungsi push yang sudah ada di hosting.
3. Buka URL HTTPS aplikasi dan muat ulang. Jika masih melihat versi lama, tutup aplikasi/PWA lalu buka ulang setelah service worker memperbarui cache.
4. Jika koneksi meminta token lagi, masukkan URL /exec terbaru dan token yang sama dengan Code.gs.

CATATAN
- HTML mengirim action=update. Backend baru memakai Submission ID dari kolom A/kolom bernama Submission ID, bukan nomor baris sintetis.
- Tes lokal: node test_backend.cjs Code.gs
- Kode belum dipasang atau di-deploy ke akun Google/hosting; lakukan langkah pemasangan di atas setelah memeriksa cadangan.
