# ScanGizi

Estimasi Nutri-Level minuman kemasan dari foto label ING, mengacu KMK HK.01.07/MENKES/301/2026.

---

## Mulai

```bash
npm install
cp .env.example .env     # isi VITE_GEMINI_API_KEY
npm run dev              # buka http://localhost:5173
```

Dapatkan API key gratis di [aistudio.google.com](https://aistudio.google.com).

---

## Cara Kerja

Pengguna memfoto bagian tabel Informasi Nilai Gizi (ING) di kemasan minuman. Gambar diproses lokal terlebih dahulu: EXIF di-strip via canvas re-encode (GPS, device ID, timestamp hilang), lalu dikompres ke max 1024px. Setelah itu dikirim ke Gemini sebagai base64.

Gemini mengekstrak nilai gizi menggunakan prompt chain-of-thought yang dikalibrasi untuk label ING Indonesia — termasuk cross-referencing antara teks dan header kolom, confidence scoring per field, dan penanganan kasus gagal secara eksplisit. Output JSON divalidasi terhadap schema whitelist sebelum digunakan ke mana pun.

Produk serbuk (kopi sachet, teh tarik, dll) ditangani berbeda. Ketika satuan saji terdeteksi dalam gram, aplikasi masuk ke alur interrupt Fase 2 dan menawarkan tiga jalur: foto petunjuk penyajian di sisi lain kemasan, input manual volume air, atau estimasi rentang dua skenario. Ini karena volume air menentukan konsentrasi final per 100ml — dan mengasumsikannya secara diam-diam akan menghasilkan error faktor 7× atau lebih.

Seluruh kalkulasi Nutri-Level dilakukan di sisi klien berdasarkan threshold Lampiran A KMK, bukan dari output AI.

---

## Kalkulasi Nutri-Level

Semua threshold dihitung per 100 ml minuman jadi:

| Zat Gizi        | A     | B        | C         | D      |
|-----------------|-------|----------|-----------|--------|
| Gula (g)        | ≤1    | 1–5      | 5–10      | >10    |
| Garam / Na (mg) | ≤5    | 5–120    | 120–500   | >500   |
| Lemak Jenuh (g) | ≤0.7  | 0.7–1.2  | 1.2–2.8   | >2.8   |

Level akhir ditentukan komponen terburuk dari tiga (Gula, Natrium, Lemak Jenuh).

Untuk produk serbuk: volume minuman jadi = massa serbuk (g) + volume air (ml). Nilai per 100ml dihitung dari volume total, bukan massa serbuk saja. Gula yang dihitung adalah net gula setelah dikurangi laktosa (Lampiran A poin 5).

---

## Struktur Project

```
├── api/
│   ├── status.js         Serverless function: cek status key aktif
│   └── analyze.js        Serverless function: API proxy aman
├── src/
│   ├── main.jsx          Entry point React
│   ├── index.css         Design tokens (dark/light mode)
│   ├── App.jsx           State machine + seluruh UI
│   ├── App.module.css    CSS Modules
│   ├── api.js            Frontend API wrapper + rate limiter
│   ├── nutriLevel.js     Logika kalkulasi KMK 301/2026
│   ├── imageUtils.js     Strip EXIF + validasi + kompresi
│   ├── security.js       Validasi schema response AI
│   └── __tests__/
│       └── nutriLevel.test.js
```

---

## Konfigurasi

**Development:** tambahkan key di `.env` (prefix `VITE_` diperlukan agar Vite expose ke browser):

```
VITE_GEMINI_API_KEY=
```

---

## Development

```bash
npm test          # unit tests (Vitest)
npm run build     # production build
```

Jalankan `npm test` setelah setiap perubahan pada `nutriLevel.js` atau `security.js`.

---

## Disclaimer

Hasil estimasi didasarkan pada label yang terbaca oleh AI — bukan penetapan resmi Nutri-Level dari Kemenkes RI. Akurasi bergantung pada kualitas foto dan kelengkapan label yang terlihat.
