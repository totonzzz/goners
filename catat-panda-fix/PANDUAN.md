# Perbaikan tombol Ubah — "aksi tidak dikenal"

## Kenapa terjadi

Frontend (yang ada tombol **Ubah**) mengirim `action: "update"` ke Web App Apps Script.
Yang menjawab masih **Code.gs lama**, yang hanya mengenal `add` dan `delete`:

```js
if (a === 'add')    return json_(appAddTransaction(p, p.token));
if (a === 'delete') return json_(appDeleteTransaction(p.id, p.token));
return json_({ ok: false, error: 'aksi tidak dikenal' });   // ← pesan yang kamu lihat
```

Jadi ini **bukan** bug di tampilan/Netlify. Yang perlu diganti hanya kode di Google Apps Script,
lalu **deployment-nya diperbarui**. Tidak ada file frontend yang wajib diganti.

## Sebelum mulai

1. Cadangkan spreadsheet (File → Make a copy) dan catat URL Web App `/exec` yang sekarang dipakai aplikasi.
2. Buka tab **Form Responses 1**, pastikan baris 1 punya kolom ini (urutan bebas):
   `Submission ID, Respondent ID, Submitted at, Tanggal Transaksi, Untuk apa?, Kategori, Tipe,
   Metode Pembayaran, Kebutuhan atau Keinginan?, Jumlah cepat, Jumlah, Nama orang, Hutang atau Piutang?`
   Kalau `Submission ID` tidak ada, server baru akan menolak dengan pesan "Kolom wajib tidak ditemukan".

## Langkah pasang (5 menit)

1. Buka spreadsheet → **Extensions → Apps Script**.
2. Hapus semua isi file `Code.gs` di editor, tempel isi **`Code.gs`** dari folder ini.
3. Ganti baris paling atas:
   ```js
   const TOKEN = "GANTI_DENGAN_TOKEN_YANG_SAMA_DI_APLIKASI";
   ```
   dengan token yang sama seperti yang kamu ketik di aplikasi. Simpan (Ctrl+S).
4. **Deploy → Manage deployments → ikon pensil (Edit) pada deployment yang aktif**
   → **Version: New version** → **Deploy**.
   Jangan pilih "New deployment" — itu membuat URL baru dan aplikasi tetap memanggil URL lama.

   > Ini langkah yang paling sering terlewat. Menyimpan file saja **tidak** mengubah Web App;
   > yang jalan di `/exec` tetap versi terakhir yang di-deploy.

5. Tutup lalu buka lagi aplikasi Catat Panda (atau tarik untuk muat ulang), tekan **Ubah** pada
   satu transaksi → ubah nominal → **Simpan perubahan**.

## Cek berhasil atau belum

Buka **`cek-server.html`** di browser, isi URL `/exec` dan token, lalu:

- **Cek versi server** → harus muncul `versi 2.0`.
  Kalau muncul "Server versi lama" / `aksi tidak dikenal`, berarti langkah 4 belum kena
  (deployment lain yang aktif, atau yang diedit bukan deployment yang dipakai URL itu).
- **Cek data & kolom** → memastikan token benar dan kolom `Submission ID` terbaca.

Halaman itu hanya membaca; tidak menulis apa pun.

## Kalau masih gagal

| Pesan di aplikasi | Artinya | Tindakan |
|---|---|---|
| `aksi tidak dikenal` | `/exec` masih kode lama | Ulangi langkah 4 pada deployment yang benar |
| `Kode rahasia ditolak` / `auth` | `TOKEN` di Code.gs ≠ token di aplikasi | Samakan keduanya |
| `Transaksi tidak ditemukan` | Data di HP masih cache lama (ID lama) | Muat ulang aplikasi, lalu coba lagi |
| `Kolom wajib tidak ditemukan: Submission ID` | Header spreadsheet tidak sesuai | Tambahkan/benahi header baris 1 |
| `Tab "Form Responses 1" tidak ditemukan` | Nama tab berubah | Kembalikan namanya, atau ubah `TRANSACTION_SHEET` |
| Halaman putih "Script function not found: doGet" saat URL dibuka di browser | Normal | Web App ini hanya menerima POST; bukan masalah |

## Catatan

- `Code.gs` di folder ini = versi 2.0: menangani `data / add / update / delete`, memakai
  `Submission ID` asli (bukan nomor baris), idempoten untuk kiriman ulang saat offline,
  dan memindahkan catatan yang dihapus ke tab **Sampah**.
- Sudah diuji dengan `test_backend.cjs` (bawaan paket perbaikan) + uji tambahan:
  baris lama tanpa ID (`row_N`) tetap bisa diedit lalu mendapat ID permanen.
- `index.html`, `sw.js`, `manifest.webmanifest`, `icons/` disertakan (versi 1.2) kalau kamu mau
  memperbarui hosting sekaligus. Tidak wajib untuk memperbaiki tombol Ubah.
