/**
 * api.js
 * ─────────────────────────────────────────────────────────────
 * Abstraksi multi-provider Vision LLM dengan prompt engineering
 * komprehensif untuk ekstraksi label ING yang andal.
 *
 * Provider yang didukung:
 * - Google Gemini  (VITE_GEMINI_API_KEY)
 * - OpenAI GPT-4o  (VITE_OPENAI_API_KEY)
 * - Anthropic      (VITE_ANTHROPIC_API_KEY)
 *
 * Teknik prompt engineering yang diterapkan:
 * 1. Chain-of-Thought — reasoning sebelum ekstraksi
 * 2. Multi-source cross-referencing — verifikasi dari 2 sumber
 * 3. Confidence scoring per field — high/medium/low/null
 * 4. Domain knowledge injection — sanity check rentang wajar
 * 5. Explicit failure mode enumeration — kondisi khusus
 * 6. Negative example injection — hindari pattern completion
 * ─────────────────────────────────────────────────────────────
 */

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah sistem ekstraksi data label "Informasi Nilai Gizi" (ING) pada kemasan produk Indonesia. Tugasmu adalah membaca tabel ING secara akurat dan mengembalikan data terstruktur.

PRINSIP UTAMA: Lebih baik mengembalikan null daripada mengarang angka yang tidak terbaca dengan jelas. Ketidakpastian yang jujur lebih baik dari kepercayaan diri yang salah.

Kembalikan HANYA JSON valid — tanpa markdown fence, tanpa komentar, tanpa teks tambahan apapun.`;

// ── User Prompt dengan semua teknik prompt engineering ────────
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

// ── Parse respons teks menjadi JSON (robust) ─────────────────────
function parseJSON(text) {
  // Strip markdown fences
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

  // Jika model menambah teks sebelum/sesudah JSON, coba ekstrak { ... }
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    if (start !== -1) cleaned = cleaned.slice(start);
  }
  const lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  // Coba parse langsung
  try {
    return JSON.parse(cleaned);
  } catch (_firstErr) {
    // Repair: trailing commas sebelum } atau ]
    let repaired = cleaned.replace(/,\s*([}\]])/g, "$1");

    // Repair: truncated JSON — auto-close brace/bracket
    const opens  = (repaired.match(/{/g) || []).length;
    const closes = (repaired.match(/}/g) || []).length;
    if (opens > closes) repaired += "}".repeat(opens - closes);

    return JSON.parse(repaired);
  }
}

// ─────────────────────────────────────────────────────────────
// PROVIDER: Google Gemini
// ─────────────────────────────────────────────────────────────
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
  return parseJSON(text);
}

// ─────────────────────────────────────────────────────────────
// PROVIDER: OpenAI GPT-4o
// ─────────────────────────────────────────────────────────────
async function callOpenAI(base64, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       "gpt-4o",
      max_tokens:  800,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" } },
            { type: "text",      text: USER_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error("Rate limit OpenAI tercapai.");
    if (res.status === 401) throw new Error("API key OpenAI tidak valid. Cek VITE_OPENAI_API_KEY di file .env");
    throw new Error(e.error?.message || `OpenAI HTTP ${res.status}`);
  }

  const d    = await res.json();
  const text = d.choices?.[0]?.message?.content || "";
  return parseJSON(text);
}

// ─────────────────────────────────────────────────────────────
// PROVIDER: Anthropic Claude
// Header 'anthropic-dangerous-direct-browser-access' diperlukan
// agar Anthropic mengizinkan request langsung dari browser.
// ─────────────────────────────────────────────────────────────
async function callAnthropic(base64, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-api-key":       apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 800,
      system:     SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text",  text: USER_PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error("Rate limit Anthropic tercapai.");
    if (res.status === 401) throw new Error("API key Anthropic tidak valid. Cek VITE_ANTHROPIC_API_KEY di file .env");
    throw new Error(e.error?.message || `Anthropic HTTP ${res.status}`);
  }

  const d    = await res.json();
  const text = (d.content || []).map(b => b.text || "").join("");
  return parseJSON(text);
}

// ─────────────────────────────────────────────────────────────
// Deteksi provider aktif dari .env
// ─────────────────────────────────────────────────────────────
export function detectProvider() {
  const gemini    = import.meta.env.VITE_GEMINI_API_KEY;
  const openai    = import.meta.env.VITE_OPENAI_API_KEY;
  const anthropic = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (gemini)    return { provider: "gemini",    key: gemini };
  if (openai)    return { provider: "openai",    key: openai };
  if (anthropic) return { provider: "anthropic", key: anthropic };
  return null;
}

export const PROVIDER_LABELS = {
  gemini:    "Google Gemini",
  openai:    "OpenAI GPT-4o",
  anthropic: "Anthropic Claude",
};

/**
 * Analisis label ING dari gambar.
 * @param {string} base64 - Gambar base64 YANG SUDAH DISANITASI EXIF
 * @returns {Promise<Object>} Data JSON hasil ekstraksi AI
 */
export async function analyzeLabel(base64) {
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
      case "gemini":    return await callGemini(base64, key);
      case "openai":    return await callOpenAI(base64, key);
      case "anthropic": return await callAnthropic(base64, key);
      default: throw new Error(`Provider tidak dikenal: ${provider}`);
    }
  } catch (err) {
    if (!err.message.startsWith("[")) {
      throw new Error(`[${provider.toUpperCase()}] ${err.message}`);
    }
    throw err;
  }
}
