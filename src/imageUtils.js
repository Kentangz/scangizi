/**
 * imageUtils.js
 * ─────────────────────────────────────────────────────────────
 * Utilitas pemrosesan gambar dengan fokus pada:
 * 1. Kompresi (efisiensi bandwidth & token API)
 * 2. Sanitasi privasi (strip EXIF — GPS, device ID, timestamp)
 *
 * CATATAN TEKNIS — Mengapa Canvas Strips EXIF:
 * Ketika gambar di-draw ke HTMLCanvasElement dan di-export
 * via toDataURL(), browser hanya menyalin data piksel.
 * Seluruh metadata EXIF (termasuk GPS coordinates, device info,
 * dan timestamp) tidak ikut di-copy karena ia bukan bagian dari
 * data piksel. Ini adalah sanitasi EXIF yang efektif dan murah.
 *
 * Referensi: UU PDP No.27 Tahun 2022 — data lokasi adalah
 * data pribadi yang membutuhkan consent eksplisit.
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Proses gambar: kompres + strip EXIF via canvas re-encode.
 *
 * @param {string} dataUrl    - Gambar asli sebagai data URL
 * @param {number} maxDim     - Dimensi maksimum sisi terpanjang (default: 1024px)
 * @param {number} quality    - Kualitas JPEG 0–1 (default: 0.82)
 * @returns {Promise<string>} - Data URL yang sudah dibersihkan dan dikompres
 */
export async function sanitizeAndCompress(dataUrl, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      let { width: w, height: h } = img;

      // Hitung dimensi baru dengan mempertahankan aspek rasio
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");

      // Gambar ke canvas — hanya data piksel yang ditransfer,
      // semua metadata EXIF (GPS, device, timestamp) ditinggalkan.
      ctx.drawImage(img, 0, 0, w, h);

      // Export sebagai JPEG baru — file baru ini bebas EXIF
      const sanitized = canvas.toDataURL("image/jpeg", quality);
      resolve(sanitized);
    };

    img.onerror = () => reject(new Error("Gagal memuat gambar untuk diproses."));
    img.src = dataUrl;
  });
}

/**
 * Baca file gambar dari input[type=file] dan kembalikan sebagai data URL.
 * @param {File} file
 * @returns {Promise<string>} data URL
 */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Gagal membaca file gambar."));
    reader.readAsDataURL(file);
  });
}

/**
 * Pipeline lengkap: baca file → sanitasi EXIF → kompres.
 * Gunakan fungsi ini sebagai satu-satunya entry point untuk
 * memproses gambar dari input pengguna.
 *
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, base64: string }>}
 */
export async function processUserImage(file) {
  const rawDataUrl   = await readFileAsDataUrl(file);
  const cleanDataUrl = await sanitizeAndCompress(rawDataUrl);
  const base64       = cleanDataUrl.split(",")[1];
  return { dataUrl: cleanDataUrl, base64 };
}
