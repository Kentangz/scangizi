/**
 * security.js
 * ─────────────────────────────────────────────────────────────
 * Validates AI JSON output against allowlist schemas to ensure
 * semantic validity before consumption by nutriLevel.js.
 * ─────────────────────────────────────────────────────────────
 */

export class ValidationError extends Error {
  constructor(field, reason) {
    super(`Validation failed for field '${field}': ${reason}`);
    this.name = "ValidationError";
    this.field = field;
    this.reason = reason;
  }
}

// Allowlist constants for schema validation
const ALLOWED_ERRORS = new Set([
  null,
  "no_ing_table_found",
  "image_unclear",
  "no_nutrition_label",
  "ambiguous_data",
]);

const ALLOWED_SATUAN = new Set(["ml", "g"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);

// Plausible numeric ranges per serving
const NUMERIC_RANGES = {
  ukuran_sajian_nilai: { min: 1, max: 2000 },
  total_gula_g:        { min: 0, max: 200 },
  natrium_mg:          { min: 0, max: 5000 },
  lemak_jenuh_g:       { min: 0, max: 100 },
  laktosa_g:           { min: 0, max: 200 },
  volume_air_ml:       { min: 1, max: 5000 },
};

/**
 * Strips ASCII control characters (codepoints < 32 except newline/tab)
 */
function stripControlChars(str) {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Validates and sanitizes the parsed AI response structure
 * @param {Object} raw - Parsed AI JSON output
 * @returns {Object} Validated and sanitized object
 * @throws {ValidationError}
 */
export function validateAIResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("root", "Response must be a valid object");
  }

  const result = {};

  // Validate error field
  if (!ALLOWED_ERRORS.has(raw.error === undefined ? null : raw.error)) {
    throw new ValidationError("error", `Value '${String(raw.error).slice(0, 50)}' is not in allowlist`);
  }
  result.error = raw.error ?? null;

  // If a valid error is present, allow remaining fields to be null
  if (result.error !== null) {
    return result;
  }

  // Validate serving unit (satuan_saji)
  if (!ALLOWED_SATUAN.has(raw.satuan_saji)) {
    throw new ValidationError("satuan_saji", `Must be 'ml' or 'g', got '${String(raw.satuan_saji).slice(0, 20)}'`);
  }
  result.satuan_saji = raw.satuan_saji;

  // Validate confidence levels
  for (const field of ["confidence_sajian", "confidence_gizi"]) {
    const val = raw[field];
    if (val != null && !ALLOWED_CONFIDENCE.has(val)) {
      throw new ValidationError(field, `Must be 'high', 'medium', or 'low', got '${String(val).slice(0, 20)}'`);
    }
    result[field] = val ?? null;
  }

  // Validate and coerce numeric fields
  for (const [field, range] of Object.entries(NUMERIC_RANGES)) {
    let val = raw[field];

    if (val == null) {
      result[field] = null;
      continue;
    }

    // Coerce string numbers if returned by AI
    if (typeof val === "string") {
      val = parseFloat(val);
    }

    if (typeof val !== "number" || Number.isNaN(val)) {
      throw new ValidationError(field, `Must be a number, got '${String(raw[field]).slice(0, 20)}'`);
    }

    if (val < range.min || val > range.max) {
      throw new ValidationError(field, `Value ${val} is out of plausible range (${range.min}-${range.max})`);
    }

    result[field] = val;
  }

  // Sanitize product name (nama_produk)
  if (raw.nama_produk != null) {
    let nama = String(raw.nama_produk);
    nama = stripControlChars(nama).trim();
    if (nama.length > 200) nama = nama.slice(0, 200);
    result.nama_produk = nama || null;
  } else {
    result.nama_produk = null;
  }

  // Sanitize reasoning
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
