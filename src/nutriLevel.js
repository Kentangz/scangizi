/**
 * nutriLevel.js
 * ─────────────────────────────────────────────────────────────
 * Logika kalkulasi Nutri-Level berdasarkan:
 * KMK HK.01.07/MENKES/301/2026, Lampiran A
 *
 * Mendukung:
 * - Produk cairan (ml) → kalkulasi langsung
 * - Produk serbuk (g)  → membutuhkan volume air pelarut
 * - Estimasi rentang   → Fase 3 "jalur cepat" (min/max volume air)
 * ─────────────────────────────────────────────────────────────
 */

export const LEVELS = ["A", "B", "C", "D"];

/** Warna sesuai spesifikasi CMYK KMK hal.10 (dikonversi ke hex) */
export const LEVEL_CONFIG = {
  A: { bg: "#00A000", light: "#E8F8E8", dark: "#004d00", label: "Sangat Baik",     desc: "Kandungan GGL sangat rendah" },
  B: { bg: "#78C800", light: "#EDF7D6", dark: "#3A6200", label: "Baik",            desc: "Kandungan GGL rendah" },
  C: { bg: "#FFB300", light: "#FFF3CC", dark: "#7A5500", label: "Perhatikan",      desc: "Kandungan GGL cukup tinggi" },
  D: { bg: "#CC0000", light: "#FFE8E8", dark: "#770000", label: "Kandungan Tinggi", desc: "Kandungan GGL tinggi" },
};

// ── Threshold per 100 ml (Lampiran A KMK 301/2026) ───────────

/** Gula (g/100ml) — monosakarida + disakarida, TIDAK termasuk laktosa */
export function getGulaLevel(g) {
  if (g <= 1)  return "A";
  if (g <= 5)  return "B";
  if (g <= 10) return "C";
  return "D";
}

/** Garam dihitung dari Natrium (mg/100ml) */
export function getGaramLevel(mg) {
  if (mg <= 5)   return "A";
  if (mg <= 120) return "B";
  if (mg <= 500) return "C";
  return "D";
}

/** Lemak Jenuh (g/100ml) */
export function getLemakLevel(g) {
  if (g <= 0.7) return "A";
  if (g <= 1.2) return "B";
  if (g <= 2.8) return "C";
  return "D";
}

/** Level akhir = komponen terburuk (tertinggi indeksnya) */
export function worstLevel(...levels) {
  return levels.reduce(
    (max, l) => (LEVELS.indexOf(l) > LEVELS.indexOf(max) ? l : max),
    "A"
  );
}

export const round1 = (v) => Math.round((v || 0) * 10) / 10;
export const round2 = (v) => Math.round((v || 0) * 100) / 100;

/**
 * Hitung komponen GGL per 100ml dari data per-sajian.
 * @param {Object} p  - data ekstraksi
 * @param {number} totalVolumeMl - volume minuman jadi dalam ml
 * @returns {Object}  komponen dan level akhir
 */
function computeComponents(p, totalVolumeMl) {
  // Gula net = total gula − laktosa (Lampiran A poin 5 KMK)
  const gulaNet  = Math.max(0, (p.total_gula_g || 0) - (p.laktosa_g || 0));

  const gula100  = (gulaNet            / totalVolumeMl) * 100;
  const garam100 = ((p.natrium_mg || 0) / totalVolumeMl) * 100;
  const lemak100 = ((p.lemak_jenuh_g || 0) / totalVolumeMl) * 100;

  const gL  = getGulaLevel(gula100);
  const gaL = getGaramLevel(garam100);
  const lL  = getLemakLevel(lemak100);
  const levelFinal = worstLevel(gL, gaL, lL);

  const components = [
    {
      name:      "Gula",
      value:     round1(gula100),
      unit:      "g",
      level:     gL,
      threshold: "A ≤1 · B ≤5 · C ≤10 · D >10",
      note: p.laktosa_g
        ? `Gula ${round1(p.total_gula_g)}g − laktosa ${round1(p.laktosa_g)}g per saji`
        : null,
    },
    {
      name:      "Garam (Na)",
      value:     round1(garam100),
      unit:      "mg",
      level:     gaL,
      threshold: "A ≤5 · B ≤120 · C ≤500 · D >500",
      note:      null,
    },
    {
      name:      "Lemak Jenuh",
      value:     round1(lemak100),
      unit:      "g",
      level:     lL,
      threshold: "A ≤0.7 · B ≤1.2 · C ≤2.8 · D >2.8",
      note:      null,
    },
  ];

  return { level: levelFinal, components, penentu: components.find(c => c.level === levelFinal) };
}

// ─────────────────────────────────────────────────────────────
// KALKULASI UTAMA — Produk Cairan
// ─────────────────────────────────────────────────────────────
/**
 * Hitung Nutri-Level untuk produk cair (satuan_saji = "ml").
 * @param {Object} extracted - output JSON dari AI
 * @returns {Object} hasil kalkulasi lengkap
 */
export function calculateLiquid(extracted) {
  const saji = parseFloat(extracted.ukuran_sajian_nilai);
  if (!saji || saji <= 0) {
    throw new Error("Ukuran sajian tidak terdeteksi. Pastikan seluruh tabel ING terlihat jelas.");
  }

  const { level, components, penentu } = computeComponents(extracted, saji);

  return {
    type:        "liquid",
    level,
    components,
    penentu,
    namaProduk:  extracted.nama_produk || null,
    sajiMl:      saji,
    volumeTotal: saji,
    confidence:  extracted.confidence_sajian || "medium",
  };
}

// ─────────────────────────────────────────────────────────────
// KALKULASI UTAMA — Produk Serbuk dengan Volume Air Diketahui
// ─────────────────────────────────────────────────────────────
/**
 * Hitung Nutri-Level untuk produk serbuk ketika volume air diketahui.
 * Volume minuman jadi = massa serbuk (g ≈ ml) + volume air (ml).
 * @param {Object} extracted - output JSON dari AI
 * @param {number} volumeAirMl - volume air pelarut dalam ml
 * @returns {Object} hasil kalkulasi lengkap
 */
export function calculatePowder(extracted, volumeAirMl) {
  const sajiG = parseFloat(extracted.ukuran_sajian_nilai);
  if (!sajiG || sajiG <= 0) {
    throw new Error("Ukuran sajian tidak terdeteksi.");
  }
  if (!volumeAirMl || volumeAirMl <= 0) {
    throw new Error("Volume air tidak valid.");
  }

  // Asumsi fisik: densitas larutan akhir ≈ 1 g/ml
  // Volume total = massa serbuk (g) + volume air (ml)
  const volumeTotal = sajiG + volumeAirMl;

  const { level, components, penentu } = computeComponents(extracted, volumeTotal);

  return {
    type:        "powder",
    level,
    components,
    penentu,
    namaProduk:  extracted.nama_produk || null,
    sajiG,
    volumeAirMl,
    volumeTotal: round1(volumeTotal),
    confidence:  extracted.confidence_sajian || "medium",
  };
}

// ─────────────────────────────────────────────────────────────
// KALKULASI FASE 3 — Estimasi Rentang (Jalur Cepat)
// Menampilkan DUA skenario (min & max air) alih-alih satu angka
// untuk menghindari false precision.
// ─────────────────────────────────────────────────────────────

/**
 * Rentang volume air standar per kategori produk (ml).
 * Batas bawah = kondisi lebih pekat (lebih konservatif untuk kesehatan).
 * Batas atas  = kondisi lebih encer (lebih optimistis).
 */
export const POWDER_WATER_RANGES = {
  kopi:    { min: 150, max: 200, label: "Kopi / Minuman kopi" },
  teh:     { min: 150, max: 250, label: "Teh / Minuman teh" },
  susu:    { min: 150, max: 200, label: "Susu / Minuman susu" },
  jus:     { min: 150, max: 250, label: "Jus / Minuman buah" },
  lainnya: { min: 150, max: 200, label: "Lainnya" },
};

/**
 * Deteksi kategori produk dari nama produk secara sederhana.
 * @param {string|null} namaProduk
 * @returns {string} key dari POWDER_WATER_RANGES
 */
export function detectPowderCategory(namaProduk) {
  if (!namaProduk) return "lainnya";
  const n = namaProduk.toLowerCase();
  if (/kopi|coffee|cappuccino|latte|espresso/.test(n)) return "kopi";
  if (/teh|tea|tarik|green tea|jasmine/.test(n)) return "teh";
  if (/susu|milk|milo|ovomaltine/.test(n)) return "susu";
  if (/jus|juice|buah|fruit/.test(n)) return "jus";
  return "lainnya";
}

/**
 * Hitung rentang Nutri-Level untuk produk serbuk tanpa info volume air.
 * Mengembalikan dua skenario: skenario_pekat (min air) dan skenario_encer (max air).
 * @param {Object} extracted
 * @returns {Object} hasil rentang estimasi
 */
export function calculatePowderRange(extracted) {
  const sajiG = parseFloat(extracted.ukuran_sajian_nilai);
  if (!sajiG || sajiG <= 0) {
    throw new Error("Ukuran sajian tidak terdeteksi.");
  }

  const kategori   = detectPowderCategory(extracted.nama_produk);
  const range      = POWDER_WATER_RANGES[kategori];

  const skenarioPekat = {
    label:       `Diseduh ${range.min} ml air (lebih pekat)`,
    volumeAirMl: range.min,
    ...computeComponents(extracted, sajiG + range.min),
  };

  const skenarioEncer = {
    label:       `Diseduh ${range.max} ml air (lebih encer)`,
    volumeAirMl: range.max,
    ...computeComponents(extracted, sajiG + range.max),
  };

  return {
    type:           "powder_range",
    namaProduk:     extracted.nama_produk || null,
    sajiG,
    kategori,
    rangeLabel:     range.label,
    skenarioPekat,
    skenarioEncer,
    confidence:     "low", // selalu low karena asumsi
  };
}
