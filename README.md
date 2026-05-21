# 🥤 ScanGizi 

Estimasi **Nutri-Level** minuman dari foto label Informasi Nilai Gizi (ING).
Kalkulasi mengacu pada **KMK HK.01.07/MENKES/301/2026 Lampiran A**.

---

## ⚡ Mulai Cepat

```bash
npm install
cp .env.example .env   # → isi salah satu API key
npm run dev            # → buka http://localhost:5173
```

---

## 🔑 Konfigurasi API Key

ScanGizi mendukung arsitektur ganda untuk kemudahan development lokal dan keamanan production:

### 1. Keamanan Production (Vercel Serverless Proxy)
Untuk menghindari kebocoran API Key di bundle JavaScript publik, ScanGizi menggunakan Vercel Serverless Functions di folder `/api`. API Key disimpan secara aman di backend. Daftarkan variabel berikut di dashboard Vercel Anda (**tanpa** prefix `VITE_`):

* `GEMINI_API_KEY` (Rekomendasi default)

> [!WARNING]
> **JANGAN PERNAH** menambahkan prefix `VITE_` pada di .env untuk production.

### 2. Development Lokal (Client-Side Fallback)
Untuk development lokal biasa (`npm run dev`), jika serverless proxy tidak terdeteksi, aplikasi akan otomatis beralih ke direct client-side call. Daftarkan API Key Anda di file `.env` lokal:

| Provider | Variabel | Link Pembuatan |
|---|---|---|
| Google Gemini| `VITE_GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

---

## 🏗️ Struktur Project

```
├── api/
│   ├── status.js         Serverless function: cek status key aktif
│   └── analyze.js        Serverless function: API proxy aman (prompt & API call)
├── src/
│   ├── main.jsx          Entry point React
│   ├── index.css         Global styles
│   ├── App.jsx           State machine + seluruh UI
│   ├── App.module.css    Styles
│   ├── api.js            Frontend API wrapper (Proxy fetcher + local fallback)
│   ├── nutriLevel.js     Logika kalkulasi KMK 301/2026
│   ├── imageUtils.js     Sanitasi EXIF + kompresi gambar
│   └── __tests__/
│       └── nutriLevel.test.js  Unit tests (npm test)
```

---

## 🚀 Deployment ke Vercel

1. Hubungkan repository GitHub Anda ke Vercel.
2. Vercel secara otomatis mendeteksi konfigurasi **Vite** dan folder backend **`/api`**.
3. Di Vercel Project Settings, masukkan environment variable rahasia (misal `GEMINI_API_KEY`).
4. Klik **Deploy**. Aplikasi akan mendeteksi backend secara asinkronus dan mengaktifkan mode secure proxy dengan indikasi visual di footer aplikasi.

---

## 🧠 Fitur yang Diimplementasikan

### ✅ Kalkulasi Nutri-Level (KMK 301/2026)
- Threshold lengkap: Gula, Garam/Na, Lemak Jenuh per 100ml
- Level akhir = komponen terburuk (KMK Lampiran A)
- Pengurangan laktosa dari total gula (Lampiran A poin 5)

### ✅ Produk Serbuk (Kopi Sachet, Teh Tarik, dll)
- Deteksi otomatis jika satuan saji dalam gram
- **Fase 2**: Interrupsi dengan 3 jalur pilihan:
  - **Jalur A**: Foto sisi lain kemasan (cari petunjuk penyajian)
  - **Jalur B**: Input manual volume air
  - **Jalur C**: Estimasi rentang cepat
- **Fase 3**: Tampilkan DUA skenario (pekat & encer) — hindari false precision

### ✅ Prompt Engineering Komprehensif
1. **Chain-of-Thought** — model reasoning sebelum ekstraksi
2. **Multi-source cross-referencing** — verifikasi dari 2 sumber (teks + header kolom)
3. **Confidence scoring** — high/medium/low per field
4. **Sanity check** — domain knowledge injection (rentang wajar sajian)
5. **Explicit failure modes** — kondisi khusus (label melengkung, 2 kolom, dll)
6. **Negative examples** — hindari pattern completion yang salah

### ✅ Privacy Sanitization
- Strip EXIF otomatis via Canvas API re-encode (GPS, device ID, timestamp dihapus)
- Kompresi ke max 1024px sebelum dikirim ke API

### ✅ Kamera Langsung (Live Camera)
- Viewfinder kamera real-time via `getUserMedia()` API langsung di dalam aplikasi
- Tombol capture, flip kamera (depan/belakang), dan close
- Stream kamera di-stop otomatis saat user keluar dari mode kamera, berpindah state, atau menutup aplikasi
- Graceful fallback ke file input jika browser tidak mendukung atau permission ditolak
- Hasil capture melewati pipeline sanitasi yang sama (strip EXIF, kompres) sebelum dikirim ke AI

### ✅ Unit Tests
```bash
npm test
```
Mencakup: boundary testing threshold, konversi per-saji → per-100ml,
validasi contoh dari KMK hal.6, kalkulasi serbuk, estimasi rentang.

---

## 📐 Logika Kalkulasi

**Per 100 ml** (semua threshold dari Lampiran A KMK):

| Zat Gizi | A | B | C | D |
|---|---|---|---|---|
| Gula (g) | ≤1 | 1–5 | 5–10 | >10 |
| Garam/Na (mg) | ≤5 | 5–120 | 120–500 | >500 |
| Lemak Jenuh (g) | ≤0.7 | 0.7–1.2 | 1.2–2.8 | >2.8 |

**Produk serbuk:**
```
Volume total = massa_serbuk(g) + volume_air(ml)
Gula per 100ml = (gula_per_saji / volume_total) × 100
```

**Mengapa BUKAN asumsi 1g=1ml:**
Sachet 25g kopi + 15g gula, diseduh 150ml air:
- Asumsi naif (÷25): gula = 60g/100ml → Level D (SALAH)
- Benar (÷175): gula = 8.57g/100ml → Level C (BENAR)
Selisih faktor 7× yang mengubah keputusan kesehatan pengguna.

---

## 🌐 Browser Compatibility

Fitur kamera langsung membutuhkan browser modern dengan dukungan MediaDevices API (Chrome, Firefox, Safari, Edge — semua versi 2020+). Pada browser yang tidak mendukung atau jika pengguna menolak izin kamera, aplikasi secara otomatis fallback ke file input biasa tanpa kehilangan fungsionalitas.

---

## ⚠️ Disclaimer

Hasil estimasi berdasarkan label ING yang terdeteksi AI — bukan klaim resmi
Nutri-Level Kemenkes RI. Akurasi bergantung pada kualitas foto dan kelengkapan label.
