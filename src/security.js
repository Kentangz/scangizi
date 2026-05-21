/**
 * security.js
 * ─────────────────────────────────────────────────────────────
 * Validasi output AI dengan schema whitelist.
 *
 * Prinsip: "allowlist over blocklist" — setiap nilai yang
 * melewati validateAIResponse() dijamin secara semantik masuk
 * akal untuk diproses oleh nutriLevel.js. Apapun yang tidak
 * masuk akal, ditolak.
 *
 * Ini bukan untuk mendeteksi prompt injection secara eksplisit,
 * tapi untuk memastikan output yang tidak sesuai schema tidak
 * pernah sampai ke kalkulasi atau DOM.
 * ─────────────────────────────────────────────────────────────
 */

// ── Error class ──────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(field, reason) {
    super(`Validasi gagal pada field '${field}': ${reason}`);
    this.name = "ValidationError";
    this.field = field;
    this.reason = reason;
  }
}

// ── Whitelist konstanta ──────────────────────────────────────

const ALLOWED_ERRORS = new Set([
  null,
  "no_ing_table_found",
  "image_unclear",
  "no_nutrition_label",
  "ambiguous_data",
]);

const ALLOWED_SATUAN = new Set(["ml", "g"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);

// Range plausibel untuk nilai numerik per saji
const NUMERIC_RANGES = {
  ukuran_sajian_nilai: { min: 1, max: 2000 },
  total_gula_g:        { min: 0, max: 200 },
  natrium_mg:          { min: 0, max: 5000 },
  lemak_jenuh_g:       { min: 0, max: 100 },
  laktosa_g:           { min: 0, max: 200 },
  volume_air_ml:       { min: 1, max: 5000 },
};

// ── Helper: sanitasi string ──────────────────────────────────

/** Strip karakter kontrol (codepoint < 32, kecuali newline/tab) */
function stripControlChars(str) {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// ── Validasi utama ───────────────────────────────────────────

/**
 * Validasi dan sanitasi respons AI.
 * @param {Object} raw - Object JavaScript hasil parse JSON dari AI
 * @returns {Object} Object yang sudah divalidasi dan disanitasi
 * @throws {ValidationError}
 */
export function validateAIResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("root", "Response bukan object yang valid");
  }

  const result = {};

  // ── error ──────────────────────────────────────────────
  if (!ALLOWED_ERRORS.has(raw.error === undefined ? null : raw.error)) {
    throw new ValidationError("error", `Nilai '${String(raw.error).slice(0, 50)}' tidak ada dalam whitelist`);
  }
  result.error = raw.error ?? null;

  // Jika error diset, izinkan semua field lain null
  if (result.error !== null) {
    return result;
  }

  // ── satuan_saji ────────────────────────────────────────
  if (!ALLOWED_SATUAN.has(raw.satuan_saji)) {
    throw new ValidationError("satuan_saji", `Harus 'ml' atau 'g', dapat '${String(raw.satuan_saji).slice(0, 20)}'`);
  }
  result.satuan_saji = raw.satuan_saji;

  // ── confidence fields ──────────────────────────────────
  for (const field of ["confidence_sajian", "confidence_gizi"]) {
    const val = raw[field];
    if (val != null && !ALLOWED_CONFIDENCE.has(val)) {
      throw new ValidationError(field, `Harus 'high', 'medium', atau 'low', dapat '${String(val).slice(0, 20)}'`);
    }
    result[field] = val ?? null;
  }

  // ── numeric fields ─────────────────────────────────────
  for (const [field, range] of Object.entries(NUMERIC_RANGES)) {
    let val = raw[field];

    // Null/undefined diizinkan untuk field opsional
    if (val == null) {
      result[field] = null;
      continue;
    }

    // Coerce string → number (AI kadang mengembalikan "35" bukan 35)
    if (typeof val === "string") {
      val = parseFloat(val);
    }

    if (typeof val !== "number" || Number.isNaN(val)) {
      throw new ValidationError(field, `Harus angka, dapat '${String(raw[field]).slice(0, 20)}'`);
    }

    if (val < range.min || val > range.max) {
      throw new ValidationError(field, `Nilai ${val} di luar range plausibel (${range.min}–${range.max})`);
    }

    result[field] = val;
  }

  // ── nama_produk (opsional, sanitasi string) ────────────
  if (raw.nama_produk != null) {
    let nama = String(raw.nama_produk);
    nama = stripControlChars(nama).trim();
    if (nama.length > 200) nama = nama.slice(0, 200);
    result.nama_produk = nama || null;
  } else {
    result.nama_produk = null;
  }

  // ── reasoning (tidak divalidasi ketat, sanitasi saja) ──
  if (raw.reasoning != null) {
    let reasoning = String(raw.reasoning);
    reasoning = stripControlChars(reasoning);
    if (reasoning.length > 5000) reasoning = reasoning.slice(0, 5000);
    result.reasoning = reasoning;
  } else {
    result.reasoning = null;
  }

  return result;
}
