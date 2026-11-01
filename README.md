# NEXTGEN STORE — Vercel Edition (V5)

Versi ini mempertahankan desain V4 dan alur toko, tetapi backend dipindahkan dari Netlify Functions ke Vercel Functions. Database JSON dan gambar disimpan di **Vercel Blob Private Store**. Tidak ada rahasia di frontend.

## Fitur
- Satu halaman autentikasi untuk member dan admin.
- Registrasi member; password disimpan sebagai hash scrypt.
- Admin ditentukan dari environment variables dan langsung diarahkan ke dashboard.
- Session cookie HttpOnly, Secure, SameSite=Lax, bertanda tangan HMAC.
- Katalog, kategori, pencarian, checkout, riwayat pesanan.
- Pembayaran QRIS NexaPayz; status diperiksa server-side sebelum pengiriman.
- Dashboard produk, stok kode, pesanan, backup ZIP, dan restore ZIP.
- Gambar dan database disimpan di Vercel Blob Private Store.

## Deploy ke Vercel

**Penting:** Vercel perlu project deployment sendiri. ZIP statis saja tidak menjalankan API. Deploy folder project ini melalui Vercel CLI atau import repository Git.

### Opsi A — Vercel CLI
1. Ekstrak ZIP.
2. Install Node.js LTS.
3. Buka terminal pada folder project.
4. Jalankan:
   ```bash
   npm install
   npx vercel login
   npx vercel link
   npx vercel deploy
   ```
5. Setelah preview berhasil, atur Environment Variables dan sambungkan Blob Store (langkah di bawah).
6. Setelah deployment, buka `/api/health`. Pastikan `ok: true` dan `storage: "connected"`. Jika `storage` bernilai `not-configured` atau `unavailable`, periksa Blob Store dan `BLOB_READ_WRITE_TOKEN`.
7. Deploy production:
   ```bash
   npx vercel deploy --prod
   ```

### Opsi B — Git integration
1. Upload folder project ke repository GitHub milik sendiri.
2. Di Vercel pilih **Add New → Project**, lalu import repository tersebut.
3. Framework preset: **Other**. Build command: `npm run build`. Output directory: `dist`.
4. Deploy, lalu sambungkan Blob Store dan isi Environment Variables.

## Database Vercel Blob
1. Buka project Vercel → **Storage** → **Create Database** → **Blob**.
2. Pilih akses **Private** (bukan Public), lalu buat store.
3. Connect store ke project dan environment yang dipakai (Production, Preview bila perlu).
4. Pastikan `BLOB_READ_WRITE_TOKEN` tersedia di Project → Settings → Environment Variables. Vercel biasanya menambahkannya saat store di-connect.

Database utama disimpan sebagai satu dokumen `database.json`; gambar disimpan di prefix `images/`. Ini praktis untuk toko kecil/tahap awal, tetapi bukan database relasional. Transaksi bersamaan dalam jumlah besar sebaiknya memakai PostgreSQL.

## Environment Variables
Atur di Vercel → Project → Settings → Environment Variables:

| Key | Keterangan |
|---|---|
| `ADMIN_USERNAME` | Username admin yang dipilih sendiri |
| `ADMIN_PASSWORD` | Password admin unik dan kuat |
| `SESSION_SECRET` | Secret acak baru, minimal 32 karakter |
| `NEXAPAYZ_BASE_URL` | `https://nexapayz.alluffystore.my.id` |
| `NEXAPAYZ_API_KEY` | API key NexaPayz yang masih aktif |
| `BLOB_READ_WRITE_TOKEN` | Token otomatis dari Blob Store Private |

Jangan menambahkan prefix `NEXT_PUBLIC_` pada secret. Jangan menyimpan password, token Blob, session secret, atau API key di `config.js`, HTML, atau JavaScript frontend. Setelah mengubah Environment Variables, buat deployment baru.

## Login
- Member: buka halaman login → Daftar → isi nama, username, email, dan password minimal 8 karakter.
- Member lama: Masuk memakai username/email dan password.
- Admin: Masuk memakai `ADMIN_USERNAME` dan `ADMIN_PASSWORD`; role admin otomatis diarahkan ke dashboard.

## Backup dan restore
- Dashboard admin → Backup & Restore → Download Backup menghasilkan ZIP berisi database operasional, stok, riwayat transaksi, dan gambar.
- Akun member/password hash dan secret sengaja tidak dimasukkan ke ZIP.
- Restore mengganti data toko dan gambar; akun yang telah terdaftar dipertahankan.
- Batas ZIP 4 MB mengikuti batas body/response Function pada konfigurasi ini.

## Penting sebelum transaksi sungguhan
1. API NexaPayz mengikuti endpoint integrasi yang sebelumnya digunakan: `GET /api/invoice?amount=...` dan `GET /api/invoice/status?id=...`, dengan header `x-api-key`. Struktur respons harus diuji menggunakan akun/API yang aktif.
2. Belum ada pengujian transaksi sungguhan. Uji dengan nominal kecil dan pastikan status pembayaran gateway cocok sebelum toko dibuka.
3. Vercel Blob adalah object storage, bukan database transaksional. Penulisan JSON memakai ETag untuk mendeteksi sebagian konflik, tetapi tidak memberi transaksi multi-record/locking sempurna.
4. Fungsi restore menerima ZIP maksimal 4 MB pada konfigurasi ini. Gambar produk maksimal 3 MB saat ditambahkan; pertimbangkan batas payload function.
5. File biner privat untuk dikirim ke pembeli belum didukung; tipe teks/link dan kode digital didukung.
6. Data lama di Netlify Blob tidak otomatis pindah. Store Vercel baru mulai kosong; gunakan backup lama hanya jika file ZIP valid dari sistem sebelumnya.

## Struktur
```text
index.html
style.css
app.js
config.js
api/[...path].mjs
server/api.mjs
scripts/build.mjs
vercel.json
```

## Fix Vercel build pattern error

The `functions` glob for `api/[...path].mjs` was removed from `vercel.json`. Vercel's bracket-style catch-all route is discovered from the file path automatically; the previous `functions` glob treated the square brackets as a glob character class and failed to match. The API function remains at `api/[...path].mjs`.
