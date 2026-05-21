/**
 * imageUtils.js
 * ─────────────────────────────────────────────────────────────
 * Utilitas pemrosesan gambar dengan fokus pada:
 * 1. Validasi file (ukuran, tipe, magic bytes)
 * 2. Kompresi (efisiensi bandwidth & token API)
 * 3. Sanitasi privasi (strip EXIF — GPS, device ID, timestamp)
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

// ── Validasi File Upload ─────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Magic byte signatures
const MAGIC = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png:  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  webpPrefix: [0x52, 0x49, 0x46, 0x46], // "RIFF"
  webpSuffix: [0x57, 0x45, 0x42, 0x50], // "WEBP" (byte 8-11)
};

const VALIDATION_MESSAGES = {
  FILE_TOO_LARGE:     "Ukuran foto maksimal 10MB.",
  INVALID_FILE_TYPE:  "Format file tidak didukung. Gunakan JPG, PNG, atau WebP.",
  INVALID_MAGIC_BYTES: "File tidak valid atau rusak. Coba foto lain.",
};

export class FileValidationError extends Error {
  constructor(code) {
    const userMessage = VALIDATION_MESSAGES[code] || "File tidak valid.";
    super(userMessage);
    this.name = "FileValidationError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

/**
 * Validasi file gambar sebelum diproses.
 * Step 1: cek ukuran, Step 2: cek MIME, Step 3: cek magic bytes.
 * @param {File} file
 * @throws {FileValidationError}
 */
export async function validateImageFile(file) {
  // Step 1 — Ukuran file
  if (file.size > MAX_FILE_SIZE) {
    throw new FileValidationError("FILE_TOO_LARGE");
  }

  // Step 2 — MIME type (filter awal, bisa di-spoof)
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new FileValidationError("INVALID_FILE_TYPE");
  }

  // Step 3 — Magic bytes (verifikasi isi file sesungguhnya)
  const header = await readFileHeader(file, 12);
  if (!matchMagicBytes(header)) {
    throw new FileValidationError("INVALID_MAGIC_BYTES");
  }
}

/** Baca N byte pertama dari file */
function readFileHeader(file, n) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new FileValidationError("INVALID_MAGIC_BYTES"));
    reader.readAsArrayBuffer(file.slice(0, n));
  });
}

/** Bandingkan header bytes dengan signatures yang diketahui */
function matchMagicBytes(bytes) {
  // JPEG: FF D8 FF
  if (bytes[0] === MAGIC.jpeg[0] && bytes[1] === MAGIC.jpeg[1] && bytes[2] === MAGIC.jpeg[2]) {
    return true;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (MAGIC.png.every((b, i) => bytes[i] === b)) {
    return true;
  }
  // WebP: RIFF....WEBP
  if (
    MAGIC.webpPrefix.every((b, i) => bytes[i] === b) &&
    MAGIC.webpSuffix.every((b, i) => bytes[i + 8] === b)
  ) {
    return true;
  }
  return false;
}

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

      ctx.drawImage(img, 0, 0, w, h);

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
 * Pipeline lengkap: validasi → baca file → sanitasi EXIF → kompres.
 * Gunakan fungsi ini sebagai satu-satunya entry point untuk
 * memproses gambar dari input pengguna.
 *
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, base64: string }>}
 * @throws {FileValidationError} jika file tidak valid
 */
export async function processUserImage(file) {
  await validateImageFile(file);
  const rawDataUrl   = await readFileAsDataUrl(file);
  const cleanDataUrl = await sanitizeAndCompress(rawDataUrl);
  const base64       = cleanDataUrl.split(",")[1];
  return { dataUrl: cleanDataUrl, base64 };
}
