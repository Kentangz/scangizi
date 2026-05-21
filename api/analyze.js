/**
 * api/analyze.js
 * ─────────────────────────────────────────────────────────────
 * Serverless function untuk memproses ekstraksi data label ING
 * secara aman di sisi server menggunakan API Key rahasia.
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
    let repaired = cleaned.replace(/,\s*([}\]])/g, "$1");
    const opens  = (repaired.match(/{/g) || []).length;
    const closes = (repaired.match(/}/g) || []).length;
    if (opens > closes) repaired += "}".repeat(opens - closes);
    return JSON.parse(repaired);
  }
}

// ── Google Gemini API Call ────────────────────────────────────
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
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error("Rate limit Gemini tercapai. Tunggu 1 menit lalu coba lagi.");
    if (res.status === 400 || res.status === 403) throw new Error("API key Gemini tidak valid.");
    throw new Error(e.error?.message || `Gemini HTTP ${res.status}`);
  }

  const d = await res.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseJSON(text);
}



// ── Serverless Handler ─────────────────────────────────────────
export default async function handler(req, res) {
  // Hanya izinkan method POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const host = req.headers.host || "";
  const origin = req.headers.origin || req.headers.referer || "";
  if (origin && !origin.includes(host) && !origin.includes("localhost")) {
    return res.status(403).json({ error: "Akses ditolak: Origin tidak diizinkan." });
  }

  const { base64 } = req.body || {};
  if (!base64) {
    return res.status(400).json({ error: "Missing image base64 data" });
  }

  // Deteksi key di server
  const gemini = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  try {
    if (!gemini) {
      return res.status(500).json({
        error: "Tidak ada Google Gemini API key yang dikonfigurasi di server. Silakan hubungi administrator website.",
      });
    }

    let result = await callGemini(base64, gemini);

    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
