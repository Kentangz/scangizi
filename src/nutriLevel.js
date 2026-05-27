/**
 * nutriLevel.js
 * ─────────────────────────────────────────────────────────────
 * Nutri-Level calculation logic based on KMK HK.01.07/MENKES/301/2026.
 * Supports liquid products, powder products, and range estimates.
 * ─────────────────────────────────────────────────────────────
 */

export const LEVELS = ["A", "B", "C", "D"];

// Colors from the official specification
export const LEVEL_CONFIG = {
  A: { bg: "#00A000", light: "#E8F8E8", dark: "#004d00", label: "Sangat Baik",     desc: "Kandungan GGL sangat rendah" },
  B: { bg: "#78C800", light: "#EDF7D6", dark: "#3A6200", label: "Baik",            desc: "Kandungan GGL rendah" },
  C: { bg: "#FFB300", light: "#FFF3CC", dark: "#7A5500", label: "Perhatikan",      desc: "Kandungan GGL cukup tinggi" },
  D: { bg: "#CC0000", light: "#FFE8E8", dark: "#770000", label: "Kandungan Tinggi", desc: "Kandungan GGL tinggi" },
};

// --- Threshold check functions ---

/** Sugar level (g/100ml) - excluding lactose */
export function getGulaLevel(g) {
  if (g <= 1)  return "A";
  if (g <= 5)  return "B";
  if (g <= 10) return "C";
  return "D";
}

/** Salt/Sodium level (mg/100ml) */
export function getGaramLevel(mg) {
  if (mg <= 5)   return "A";
  if (mg <= 120) return "B";
  if (mg <= 500) return "C";
  return "D";
}

/** Saturated fat level (g/100ml) */
export function getLemakLevel(g) {
  if (g <= 0.7) return "A";
  if (g <= 1.2) return "B";
  if (g <= 2.8) return "C";
  return "D";
}

/** Returns the worst level among components */
export function worstLevel(...levels) {
  return levels.reduce(
    (max, l) => (LEVELS.indexOf(l) > LEVELS.indexOf(max) ? l : max),
    "A"
  );
}

export const round1 = (v) => Math.round((v || 0) * 10) / 10;

/**
 * Computes components values per 100ml
 */
function computeComponents(p, totalVolumeMl) {
  // Net sugar = total sugars - lactose
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

/**
 * Calculates Nutri-Level for liquid products
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

/**
 * Calculates Nutri-Level for powder products with known water volume
 */
export function calculatePowder(extracted, volumeAirMl) {
  const sajiG = parseFloat(extracted.ukuran_sajian_nilai);
  if (!sajiG || sajiG <= 0) {
    throw new Error("Ukuran sajian tidak terdeteksi.");
  }
  if (!volumeAirMl || volumeAirMl <= 0) {
    throw new Error("Volume air tidak valid.");
  }

  // Total volume = powder mass (g) + water volume (ml)
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

// Standard water volume ranges per category
export const POWDER_WATER_RANGES = {
  kopi:    { min: 150, max: 200, label: "Kopi / Minuman kopi" },
  teh:     { min: 150, max: 250, label: "Teh / Minuman teh" },
  susu:    { min: 150, max: 200, label: "Susu / Minuman susu" },
  jus:     { min: 150, max: 250, label: "Jus / Minuman buah" },
  lainnya: { min: 150, max: 200, label: "Lainnya" },
};

/**
 * Detects product category from its name
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
 * Calculates Nutri-Level range for powder products when water volume is unknown
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
    confidence:     "low",
  };
}
