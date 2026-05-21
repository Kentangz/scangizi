/**
 * api/status.js
 * ─────────────────────────────────────────────────────────────
 * Serverless function untuk mendeteksi provider AI mana yang aktif
 * di environment server (Vercel) tanpa mengekspos isi key-nya.
 * ─────────────────────────────────────────────────────────────
 */

export default async function handler(req, res) {
  // Hanya izinkan method GET
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Baca environment variables di server
  const gemini = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  let activeProvider = null;
  if (gemini) {
    activeProvider = "gemini";
  }

  // Set Cache-Control agar Vercel CDN/browser tidak mencache terlalu lama saat konfigurasi diubah
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({ provider: activeProvider });
}
