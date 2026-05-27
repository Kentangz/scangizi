/**
 * api.js
 * ─────────────────────────────────────────────────────────────
 * Vision LLM (Google Gemini) abstraction with robust prompt engineering
 * to extract nutrition information label data reliably.
 * ─────────────────────────────────────────────────────────────
 */

import { validateAIResponse, ValidationError } from "./security.js";

// System Prompt
const SYSTEM_PROMPT = `Kamu adalah sistem ekstraksi data label "Informasi Nilai Gizi" (ING) pada kemasan produk Indonesia. Tugasmu adalah membaca tabel ING secara akurat dan mengembalikan data terstruktur.

PRINSIP UTAMA: Lebih baik mengembalikan null daripada mengarang angka yang tidak terbaca dengan jelas. Ketidakpastian yang jujur lebih baik dari kepercayaan diri yang salah.

Kembalikan HANYA JSON valid — tanpa markdown fence, tanpa komentar, tanpa teks tambahan apapun.`;

// User Prompt
const USER_PROMPT = `Ikuti prosedur dua langkah berikut dengan ketat.

━━ LANGKAH 1: OBSERVASI (Chain-of-Thought) ━━━━━━━━━━━━━━━━━━
Sebelum mengisi nilai apapun, deskripsikan dalam field "reasoning":
• Kondisi gambar: jelas / buram / melengkung / terpotong / gelap
• Apakah tabel ING terlihat? Di mana posisinya?
• Kondisi teks "Takaran Saji": terbaca jelas / sebagian buram / tidak terbaca
• Sumber mana untuk takaran saji:
  - SUMBER A: teks di atas tabel ("Takaran Saji: X ml")  
  - SUMBER B: header kolom tabel ("per X ml" atau "per saji")
  - Jika kedua sumber ada dan sama → confidence "high"
  - Jika hanya satu sumber → confidence "medium"
  - Jika keduanya tidak terbaca → confidence "low"

━━ LANGKAH 2: EKSTRAKSI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Kembalikan JSON berikut (jangan ubah nama field):

{
  "reasoning": "deskripsi singkat kondisi gambar dan sumber data",
  "error": null,
  "nama_produk": null,
  "satuan_saji": "ml",
  "ukuran_sajian_nilai": 0,
  "confidence_sajian": "high",
  "volume_air_ml": null,
  "total_gula_g": 0,
  "laktosa_g": null,
  "natrium_mg": 0,
  "lemak_jenuh_g": 0,
  "confidence_gizi": "high"
}

━━ ATURAN FIELD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• satuan_saji     : "ml" atau "g". Jika serbuk/bubuk → "g"
• ukuran_sajian_nilai : angka tanpa satuan (contoh: 250, bukan "250ml")
• volume_air_ml   : jika ada teks petunjuk penyajian ("tambah 150ml air")
                    isi angkanya. Jika tidak ada → null
• total_gula_g    : baris "Total Gula" / "Sugars" dalam gram per saji
• laktosa_g       : baris "Laktosa" / "Lactose" dalam gram, null jika tidak ada
• natrium_mg      : baris "Natrium" / "Sodium" dalam mg.
                    JIKA tertulis dalam gram → kalikan 1000
• lemak_jenuh_g   : baris "Lemak Jenuh" / "Saturated Fat" dalam gram
• confidence_gizi : "high" jika semua nilai gizi terbaca jelas,
                    "medium" jika ada 1-2 field yang kurang jelas,
                    "low" jika mayoritas tidak terbaca

━━ SANITY CHECK — tolak angka yang tidak masuk akal ━━━━━━━━━
Setelah mengekstrak, verifikasi:
• Minuman cair (ml): wajar 100–2000 ml per saji
• Produk serbuk (g): wajar 15–80 g per saji
• Jika di luar rentang → tulis anomali di "reasoning", set confidence "low"

━━ KONDISI KHUSUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Label melengkung (botol): waspadai 0↔O, 5↔S, 1↔l. Gunakan konteks.
• Dua kolom ("per saji" DAN "per 100ml"): SELALU ambil kolom "per saji".
  Sistem akan konversi ke per 100ml sendiri. Mengambil kolom yang salah
  akan menghasilkan error kalkulasi yang sulit dideteksi.
• Tabel ING tidak terlihat sama sekali: set error="no_ing_table_found",
  semua field lain null. Jangan ekstrak dari komposisi atau klaim gizi.
• Teks tertutup jari/bayangan: null untuk field itu, confidence "low".

━━ CONTOH OUTPUT YANG SALAH — jangan lakukan ini ━━━━━━━━━━━━
Situasi: Angka takaran saji buram, tidak terbaca jelas
SALAH: {"ukuran_sajian_nilai": 250, "confidence_sajian": "high"}
→ Model mengarang angka 250 karena sering muncul di data, bukan karena
  terbaca di gambar. Ini merusak akurasi kalkulasi Nutri-Level.

BENAR: {"ukuran_sajian_nilai": null, "confidence_sajian": "low",
        "reasoning": "Teks takaran saji tidak terbaca karena buram..."}`;

// Robust JSON parsing and repairing from AI response
function parseJSON(text) {
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    if (start !== -1) cleaned = cleaned.slice(start);
  }
  const lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (_firstErr) {
    // Repair trailing commas before closing braces/brackets
    let repaired = cleaned.replace(/,\s*([}\]])/g, "$1");

    // Repair truncated JSON
    const opens  = (repaired.match(/{/g) || []).length;
    const closes = (repaired.match(/}/g) || []).length;
    if (opens > closes) repaired += "}".repeat(opens - closes);

    return JSON.parse(repaired);
  }
}

// Client-Side Rate Limiting (localStorage-backed)
const RL_KEY = "scangizi_rl";
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour window
const RL_MAX_REQUESTS = 15;

class RateLimitError extends Error {
  constructor(retryAfterMs) {
    const menit = Math.ceil(retryAfterMs / 60000);
    super(`Batas scan tercapai. Coba lagi dalam ${menit} menit.`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function checkRateLimit() {
  try {
    const raw = localStorage.getItem(RL_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    
    if (!state || typeof state !== "object" || typeof state.count !== "number" || typeof state.windowStart !== "number") {
      localStorage.removeItem(RL_KEY);
      return;
    }

    const now = Date.now();
    if (now - state.windowStart > RL_WINDOW_MS) {
      localStorage.setItem(RL_KEY, JSON.stringify({ count: 0, windowStart: now }));
      return;
    }
    if (state.count >= RL_MAX_REQUESTS) {
      const sisaMs = RL_WINDOW_MS - (now - state.windowStart);
      throw new RateLimitError(sisaMs);
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
  }
}

export function incrementRateLimit() {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(RL_KEY);
    if (!raw) {
      localStorage.setItem(RL_KEY, JSON.stringify({ count: 1, windowStart: now }));
      return;
    }
    const state = JSON.parse(raw);
    if (now - state.windowStart > RL_WINDOW_MS) {
      localStorage.setItem(RL_KEY, JSON.stringify({ count: 1, windowStart: now }));
    } else {
      state.count += 1;
      localStorage.setItem(RL_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage issues to prevent blocking main execution flow
  }
}

// Development helper to reset rate limiter
export const resetRateLimit = import.meta.env.DEV
  ? () => { try { localStorage.removeItem(RL_KEY); } catch {} }
  : undefined;

// Provider Integration: Google Gemini
async function callGemini(base64, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: "image/jpeg", data: base64 } },
          { text: USER_PROMPT },
        ],
      }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig:  {
        temperature: 0.1,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error("Rate limit Gemini tercapai. Tunggu 1 menit lalu coba lagi.");
    if (res.status === 400 || res.status === 403) throw new Error("API key Gemini tidak valid. Cek VITE_GEMINI_API_KEY di file .env");
    throw new Error(e.error?.message || `Gemini HTTP ${res.status}`);
  }

  const d    = await res.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseJSON(text);
  try {
    return validateAIResponse(parsed);
  } catch (err) {
    if (err instanceof ValidationError) {
      console.warn(`[ScanGizi] Validasi AI gagal: ${err.field} — ${err.reason}`);
      throw new Error("Hasil tidak dapat dibaca. Coba foto ulang dengan pencahayaan lebih baik.");
    }
    throw err;
  }
}

// Local Environment Provider Detection
export function detectProvider() {
  const gemini = import.meta.env.VITE_GEMINI_API_KEY;
  if (gemini) return { provider: "gemini", key: gemini };
  return null;
}

export const PROVIDER_LABELS = {
  gemini: "Google Gemini",
};

/**
 * Detects the active provider (proxy or local environment)
 * @returns {Promise<{provider: string, isProxy: boolean} | null>}
 */
export async function getActiveProvider() {
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const data = await res.json();
      if (data.provider) {
        return { provider: data.provider, isProxy: true };
      }
    }
  } catch (_e) {
    // Ignore proxy check error, will fallback to local detection
  }

  const local = detectProvider();
  return local ? { provider: local.provider, isProxy: false } : null;
}

/**
 * Client-side direct call fallback for development
 */
async function analyzeLabelClientSide(base64) {
  const detected = detectProvider();
  if (!detected) {
    throw new Error(
      "Tidak ada API key yang dikonfigurasi.\n" +
      "Salin .env.example → .env lalu isi salah satu API key, kemudian restart server."
    );
  }

  const { provider, key } = detected;
  try {
    switch (provider) {
      case "gemini": return await callGemini(base64, key);
      default: throw new Error(`Provider tidak dikenal: ${provider}`);
    }
  } catch (err) {
    if (!err.message.startsWith("[")) {
      throw new Error(`[${provider.toUpperCase()}] ${err.message}`);
    }
    throw err;
  }
}

/**
 * Main entry point: analyzes the nutrition label from the image.
 * Tries serverless proxy first, with client-side direct fallback.
 * @param {string} base64 - EXIF-sanitized base64 image data
 * @returns {Promise<Object>} Structured JSON data from AI extraction
 */
export async function analyzeLabel(base64) {
  checkRateLimit();
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64 }),
    });

    if (res.ok) {
      incrementRateLimit();
      const data = await res.json();
      try {
        return validateAIResponse(data);
      } catch (err) {
        if (err instanceof ValidationError) {
          console.warn(`[ScanGizi] Validasi proxy gagal: ${err.field} — ${err.reason}`);
          throw new Error("Hasil tidak dapat dibaca. Coba foto ulang dengan pencahayaan lebih baik.");
        }
        throw err;
      }
    }

    const errData = await res.json().catch(() => ({}));
    if (res.status === 404) {
      throw new Error("PROXY_NOT_FOUND");
    }
    throw new Error(errData.error || `Serverless Error HTTP ${res.status}`);
  } catch (err) {
    const isNetworkOr404 =
      err.message === "PROXY_NOT_FOUND" ||
      err.message.includes("Failed to fetch") ||
      err.message.includes("fetch failed") ||
      err.message.includes("NetworkError");

    if (isNetworkOr404) {
      console.warn("[ScanGizi] Proxy serverless tidak tersedia, menggunakan fallback client-side...");
      const result = await analyzeLabelClientSide(base64);
      incrementRateLimit();
      return result;
    }
    throw err;
  }
}
