/**
 * imageUtils.js
 * ─────────────────────────────────────────────────────────────
 * Image processing utilities for validation, EXIF sanitization,
 * and canvas-based compression.
 * ─────────────────────────────────────────────────────────────
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Magic byte signatures for JPEG, PNG, and WebP
const MAGIC = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png:  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  webpPrefix: [0x52, 0x49, 0x46, 0x46], // "RIFF"
  webpSuffix: [0x57, 0x45, 0x42, 0x50], // "WEBP" (bytes 8-11)
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
 * Validates the image file size, MIME type, and magic bytes.
 * @param {File} file
 * @throws {FileValidationError}
 */
export async function validateImageFile(file) {
  // Step 1: Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new FileValidationError("FILE_TOO_LARGE");
  }

  // Step 2: Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new FileValidationError("INVALID_FILE_TYPE");
  }

  // Step 3: Validate magic bytes (real file type check)
  const header = await readFileHeader(file, 12);
  if (!matchMagicBytes(header)) {
    throw new FileValidationError("INVALID_MAGIC_BYTES");
  }
}

/**
 * Reads first N bytes of a file
 */
function readFileHeader(file, n) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new FileValidationError("INVALID_MAGIC_BYTES"));
    reader.readAsArrayBuffer(file.slice(0, n));
  });
}

/**
 * Matches header bytes against known signatures
 */
function matchMagicBytes(bytes) {
  // JPEG: FF D8 FF
  if (bytes[0] === MAGIC.jpeg[0] && bytes[1] === MAGIC.jpeg[1] && bytes[2] === MAGIC.jpeg[2]) {
    return true;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (MAGIC.png.every((b, i) => bytes[i] === b)) {
    return true;
  }
  // WebP: "RIFF" prefix and "WEBP" suffix
  if (
    MAGIC.webpPrefix.every((b, i) => bytes[i] === b) &&
    MAGIC.webpSuffix.every((b, i) => bytes[i + 8] === b)
  ) {
    return true;
  }
  return false;
}

/**
 * Compresses and sanitizes EXIF data via canvas re-encoding
 * @param {string} dataUrl - Original image data URL
 * @param {number} maxDim - Maximum dimension limit
 * @param {number} quality - JPEG compression quality (0-1)
 * @returns {Promise<string>} Sanitized and compressed JPEG data URL
 */
export async function sanitizeAndCompress(dataUrl, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      let { width: w, height: h } = img;

      // Scale dimensions maintaining aspect ratio
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

      // Re-encoding to JPEG strips all EXIF metadata automatically
      const sanitized = canvas.toDataURL("image/jpeg", quality);
      resolve(sanitized);
    };

    img.onerror = () => reject(new Error("Gagal memuat gambar untuk diproses."));
    img.src = dataUrl;
  });
}

/**
 * Reads a File object as a data URL
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
 * Full image processing pipeline: validation -> read -> sanitization -> compression
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, base64: string }>}
 * @throws {FileValidationError}
 */
export async function processUserImage(file) {
  await validateImageFile(file);
  const rawDataUrl   = await readFileAsDataUrl(file);
  const cleanDataUrl = await sanitizeAndCompress(rawDataUrl);
  const base64       = cleanDataUrl.split(",")[1];
  return { dataUrl: cleanDataUrl, base64 };
}
