/**
 * nutriLevel.test.js
 * ─────────────────────────────────────────────────────────────
 * Unit test untuk logika kalkulasi KMK 301/2026.
 * Karena ini kode deterministik, target: 100% pass rate.
 *
 * Jalankan: npm test
 * ─────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import {
  getGulaLevel, getGaramLevel, getLemakLevel, worstLevel,
  calculateLiquid, calculatePowder, calculatePowderRange,
  detectPowderCategory,
} from "../nutriLevel.js";

// ═══════════════════════════════════════════════════════════════
// UNIT: Threshold per komponen
// ═══════════════════════════════════════════════════════════════

describe("getGulaLevel — threshold per 100ml", () => {
  // Batas atas Level A
  it("0g → A",    () => expect(getGulaLevel(0)).toBe("A"));
  it("1.0g → A",  () => expect(getGulaLevel(1.0)).toBe("A"));
  // Batas bawah Level B
  it("1.1g → B",  () => expect(getGulaLevel(1.1)).toBe("B"));
  it("3g → B",    () => expect(getGulaLevel(3)).toBe("B"));
  it("5.0g → B",  () => expect(getGulaLevel(5.0)).toBe("B"));
  // Batas bawah Level C
  it("5.1g → C",  () => expect(getGulaLevel(5.1)).toBe("C"));
  it("7.5g → C",  () => expect(getGulaLevel(7.5)).toBe("C"));
  it("10.0g → C", () => expect(getGulaLevel(10.0)).toBe("C"));
  // Batas bawah Level D
  it("10.1g → D", () => expect(getGulaLevel(10.1)).toBe("D"));
  it("15g → D",   () => expect(getGulaLevel(15)).toBe("D"));
  it("60g → D",   () => expect(getGulaLevel(60)).toBe("D"));
});

describe("getGaramLevel — threshold per 100ml", () => {
  it("0mg → A",    () => expect(getGaramLevel(0)).toBe("A"));
  it("5mg → A",    () => expect(getGaramLevel(5)).toBe("A"));
  it("6mg → B",    () => expect(getGaramLevel(6)).toBe("B"));
  it("120mg → B",  () => expect(getGaramLevel(120)).toBe("B"));
  it("121mg → C",  () => expect(getGaramLevel(121)).toBe("C"));
  it("500mg → C",  () => expect(getGaramLevel(500)).toBe("C"));
  it("501mg → D",  () => expect(getGaramLevel(501)).toBe("D"));
  it("1000mg → D", () => expect(getGaramLevel(1000)).toBe("D"));
});

describe("getLemakLevel — threshold per 100ml", () => {
  it("0g → A",    () => expect(getLemakLevel(0)).toBe("A"));
  it("0.7g → A",  () => expect(getLemakLevel(0.7)).toBe("A"));
  it("0.71g → B", () => expect(getLemakLevel(0.71)).toBe("B"));
  it("1.2g → B",  () => expect(getLemakLevel(1.2)).toBe("B"));
  it("1.21g → C", () => expect(getLemakLevel(1.21)).toBe("C"));
  it("2.8g → C",  () => expect(getLemakLevel(2.8)).toBe("C"));
  it("2.81g → D", () => expect(getLemakLevel(2.81)).toBe("D"));
  it("5g → D",    () => expect(getLemakLevel(5)).toBe("D"));
});

describe("worstLevel — komponen terburuk menang", () => {
  it("A,A,A → A",  () => expect(worstLevel("A","A","A")).toBe("A"));
  it("A,B,A → B",  () => expect(worstLevel("A","B","A")).toBe("B"));
  it("C,B,A → C",  () => expect(worstLevel("C","B","A")).toBe("C"));
  it("A,A,D → D",  () => expect(worstLevel("A","A","D")).toBe("D"));
  it("D,D,D → D",  () => expect(worstLevel("D","D","D")).toBe("D"));
  it("B,C,B → C",  () => expect(worstLevel("B","C","B")).toBe("C"));
});

// ═══════════════════════════════════════════════════════════════
// UNIT: Konversi per-saji → per-100ml
// Contoh dari halaman 6 KMK 301/2026 sebagai ground truth resmi
// ═══════════════════════════════════════════════════════════════

describe("calculateLiquid — konversi per-saji ke per-100ml", () => {
  // Contoh 1 KMK hal.6: gula 19g per 250ml, laktosa 4g
  // Gula net = 19-4 = 15g → per 100ml = 6g → Level C
  it("Contoh KMK 1: 19g gula - 4g laktosa / 250ml → 6g/100ml → C", () => {
    const r = calculateLiquid({
      ukuran_sajian_nilai: 250,
      total_gula_g:  19,
      laktosa_g:     4,
      natrium_mg:    0,
      lemak_jenuh_g: 0,
    });
    expect(r.components[0].value).toBeCloseTo(6, 1);
    expect(r.components[0].level).toBe("C");
  });

  // Contoh 2 KMK hal.6: gula 41g per 330ml, laktosa 8g
  // Gula net = 33g → per 100ml = 10g → Level C (batas atas C)
  it("Contoh KMK 2: 41g gula - 8g laktosa / 330ml → 10g/100ml → C", () => {
    const r = calculateLiquid({
      ukuran_sajian_nilai: 330,
      total_gula_g:  41,
      laktosa_g:     8,
      natrium_mg:    0,
      lemak_jenuh_g: 0,
    });
    expect(r.components[0].value).toBeCloseTo(10, 1);
    expect(r.components[0].level).toBe("C");
  });

  // Contoh 3 KMK hal.6: gula 20g per 500ml, tanpa laktosa
  // Gula net = 20g → per 100ml = 4g → Level B
  it("Contoh KMK 3: 20g gula / 500ml → 4g/100ml → B", () => {
    const r = calculateLiquid({
      ukuran_sajian_nilai: 500,
      total_gula_g:  20,
      laktosa_g:     null,
      natrium_mg:    0,
      lemak_jenuh_g: 0,
    });
    expect(r.components[0].value).toBeCloseTo(4, 1);
    expect(r.components[0].level).toBe("B");
  });

  // Level akhir ditentukan komponen terburuk
  it("Gula=A tapi Garam=D → level akhir D", () => {
    const r = calculateLiquid({
      ukuran_sajian_nilai: 100,
      total_gula_g:  0.5,  // → 0.5g/100ml → A
      laktosa_g:     null,
      natrium_mg:    600,  // → 600mg/100ml → D
      lemak_jenuh_g: 0.1,  // → 0.1g/100ml → A
    });
    expect(r.level).toBe("D");
    expect(r.penentu.name).toBe("Garam (Na)");
  });

  // Error jika ukuran saji tidak ada
  it("ukuran saji null → throw error", () => {
    expect(() => calculateLiquid({ ukuran_sajian_nilai: null })).toThrow();
  });

  it("ukuran saji 0 → throw error", () => {
    expect(() => calculateLiquid({ ukuran_sajian_nilai: 0 })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// UNIT: Produk Serbuk
// ═══════════════════════════════════════════════════════════════

describe("calculatePowder — volume total = serbuk + air", () => {
  // Kopi sachet 25g, gula 15g, diseduh 150ml air
  // Volume total = 25+150 = 175ml
  // Gula per 100ml = (15/175)*100 ≈ 8.57g → Level C
  it("Kopi sachet 25g + 150ml air → gula 8.57g/100ml → C", () => {
    const r = calculatePowder(
      { ukuran_sajian_nilai: 25, total_gula_g: 15, laktosa_g: null, natrium_mg: 100, lemak_jenuh_g: 0.5 },
      150
    );
    expect(r.volumeTotal).toBeCloseTo(175, 0);
    expect(r.components[0].value).toBeCloseTo(8.57, 1);
    expect(r.components[0].level).toBe("C");
  });

  // VALIDASI: asumsi 1g=1ml naive (pembagi 25) hasilnya SALAH (60g/100ml)
  // Ini membuktikan mengapa kita TIDAK menggunakan asumsi 1g=1ml
  it("VALIDASI: 1g=1ml naive menghasilkan gula 60g/100ml — SALAH", () => {
    const naive = calculateLiquid({
      ukuran_sajian_nilai: 25, // Menggunakan 25 sebagai ml (naive)
      total_gula_g: 15,
      laktosa_g: null,
      natrium_mg: 0,
      lemak_jenuh_g: 0,
    });
    // Ini jauh lebih tinggi dari kenyataan → membuktikan bug asumsi 1g=1ml
    expect(naive.components[0].value).toBeCloseTo(60, 0);
    expect(naive.level).toBe("D"); // Hasilnya lebih buruk dari seharusnya
  });

  it("volume air 0 → throw error", () => {
    expect(() => calculatePowder({ ukuran_sajian_nilai: 25 }, 0)).toThrow();
  });
});

describe("calculatePowderRange — estimasi rentang dua skenario", () => {
  const extracted = {
    nama_produk: "Kopi Susu Sachet",
    ukuran_sajian_nilai: 25,
    total_gula_g:  15,
    laktosa_g:     null,
    natrium_mg:    100,
    lemak_jenuh_g: 0.5,
  };

  it("kategori kopi → range 150–200ml", () => {
    const r = calculatePowderRange(extracted);
    expect(r.kategori).toBe("kopi");
    expect(r.skenarioPekat.volumeAirMl).toBe(150);
    expect(r.skenarioEncer.volumeAirMl).toBe(200);
  });

  it("skenario pekat lebih buruk atau sama dengan skenario encer", () => {
    const r = calculatePowderRange(extracted);
    const levelOrder = { A: 0, B: 1, C: 2, D: 3 };
    expect(levelOrder[r.skenarioPekat.level]).toBeGreaterThanOrEqual(
      levelOrder[r.skenarioEncer.level]
    );
  });

  it("confidence selalu 'low' karena asumsi", () => {
    const r = calculatePowderRange(extracted);
    expect(r.confidence).toBe("low");
  });
});

describe("detectPowderCategory", () => {
  it("kopi susu → kopi",           () => expect(detectPowderCategory("Kopi Susu Instan")).toBe("kopi"));
  it("cappuccino → kopi",          () => expect(detectPowderCategory("Cappuccino Mix")).toBe("kopi"));
  it("teh tarik → teh",            () => expect(detectPowderCategory("Teh Tarik Bubuk")).toBe("teh"));
  it("susu coklat → susu",         () => expect(detectPowderCategory("Susu Coklat Bubuk")).toBe("susu"));
  it("null → lainnya",             () => expect(detectPowderCategory(null)).toBe("lainnya"));
  it("produk tidak dikenal → lainnya", () => expect(detectPowderCategory("Produk XYZ")).toBe("lainnya"));
});
