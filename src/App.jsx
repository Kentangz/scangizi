/**
 * App.jsx — ScanGizi
 * ─────────────────────────────────────────────────────────────
 * State machine untuk semua alur pengguna yang didiskusikan:
 *
 * STATES:
 *  "idle"            → layar awal, upload foto
 *  "scanning"        → AI sedang memproses
 *  "result_liquid"   → hasil untuk produk cair (normal)
 *  "powder_interrupt"→ produk serbuk terdeteksi, info air tidak ada
 *  "result_powder"   → hasil kalkulasi serbuk (volume air diketahui)
 *  "result_range"    → Fase 3: estimasi rentang dua skenario
 *  "error"           → error yang tidak bisa dipulihkan
 *
 * User flow untuk produk serbuk:
 *  Fase 1: AI ekstrak → deteksi gram + tidak ada volume_air_ml
 *  Fase 2: Interrupsi → tawarkan tiga jalur
 *    Jalur A: Foto petunjuk penyajian (foto kedua)
 *    Jalur B: Input manual volume air
 *    Jalur C (Fase 3): Estimasi rentang (conservative approach)
 *  Fase 3: Tampilkan DUA skenario (min & max air) — bukan satu angka
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { analyzeLabel, detectProvider, PROVIDER_LABELS } from "./api.js";
import { processUserImage } from "./imageUtils.js";
import {
  calculateLiquid, calculatePowder, calculatePowderRange,
  LEVELS, LEVEL_CONFIG,
} from "./nutriLevel.js";
import S from "./App.module.css";

// Tabel referensi threshold untuk UI
const THRESH = [
  { name: "Gula (g)",          A: "≤1",   B: "1–5",    C: "5–10",   D: ">10"  },
  { name: "Garam / Na (mg)",   A: "≤5",   B: "5–120",  C: "120–500",D: ">500" },
  { name: "Lemak Jenuh (g)",   A: "≤0.7", B: "0.7–1.2",C: "1.2–2.8",D: ">2.8"},
];

// ── Sub-komponen: Nutri-Level Bar ─────────────────────────────
function NutriBar({ activeLevel }) {
  return (
    <div className={S.nlBar}>
      {LEVELS.map(l => {
        const active = l === activeLevel;
        const cfg    = LEVEL_CONFIG[l];
        return (
          <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className={`${S.nlBox} ${active ? S.nlActive : S.nlInactive}`}
              style={active ? { background: cfg.bg, boxShadow: `0 6px 24px ${cfg.bg}55` } : {}}>
              {l}
            </div>
            {active && (
              <div className={S.nlLabelText}>{cfg.label}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-komponen: Detail Komponen GGL ─────────────────────────
function ComponentRows({ components }) {
  return components.map((c, i) => {
    const cfg = LEVEL_CONFIG[c.level];
    return (
      <div key={i} className={S.compRow}
        style={{ borderBottom: i < 2 ? `1px dotted var(--divider-color)` : "none" }}>
        <div className={S.compLeft}>
          <div className={S.compName}>{c.name}</div>
          <div className={S.compVal}>
            <span className={S.compValNum}>{c.value}</span> {c.unit}/100ml
          </div>
          {c.note && <div className={S.compNote}>{c.note}</div>}
          <div className={S.compThresh}>{c.threshold}</div>
        </div>
        <span className={S.levelPill} style={{ background: cfg.bg }}>{c.level}</span>
      </div>
    );
  });
}

// ── Sub-komponen: Kartu Skenario (untuk range view) ──────────
function SkenarioCard({ sk, label }) {
  const cfg = LEVEL_CONFIG[sk.level];
  return (
    <div className={S.skenarioCard} style={{ borderColor: cfg.bg }}>
      <div className={S.skenarioHeader} style={{ background: cfg.light }}>
        <span style={{ fontWeight: 800, color: cfg.dark }}>{label}</span>
        <span className={S.levelPill} style={{ background: cfg.bg, fontSize: 11 }}>
          Level {sk.level}
        </span>
      </div>
      <div style={{ padding: "10px 14px" }}>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{sk.label}</div>
        {sk.components.map((c, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between",
            fontSize: 12, padding: "4px 0",
            borderBottom: i < 2 ? "0.5px dotted var(--divider-color)" : "none",
            color: "var(--text-primary)"
          }}>
            <span>{c.name}</span>
            <span>
              <strong>{c.value}</strong> {c.unit}/100ml
              <span className={S.miniPill} style={{ background: LEVEL_CONFIG[c.level].bg }}>
                {c.level}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sub-komponen: Confidence Badge ───────────────────────────
function ConfidenceBadge({ level }) {
  const cfg = {
    high:   { bg: "#004d00", c: "#4ADE80", label: "Akurasi Tinggi" },
    medium: { bg: "#5C4A00", c: "#FBBF24", label: "Akurasi Sedang" },
    low:    { bg: "#5C0000", c: "#FF6B6B", label: "Akurasi Rendah" },
  }[level] || { bg: "var(--bg-input)", c: "var(--text-secondary)", label: "Tidak diketahui" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 8px",
      borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.c,
    }}>
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [uiState,   setUiState]   = useState("idle");
  const [imgData,   setImgData]   = useState(null);    // { dataUrl, base64 }
  const [extracted, setExtracted] = useState(null);    // raw JSON dari AI
  const [result,    setResult]    = useState(null);    // hasil kalkulasi
  const [manualAir, setManualAir] = useState(150);     // volume air manual (ml)
  const [error,     setError]     = useState(null);
  const fileRef = useRef(null);
  const powderPhotoRef = useRef(null);

  // ── Theme state ───────────────────────────────────────────
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem("scangizi-theme");
      return saved ? saved === "dark" : true;
    } catch { return true; }
  });

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      try { localStorage.setItem("scangizi-theme", next ? "dark" : "light"); } catch {}
      return next;
    });
  }, []);

  // ── Camera state ──────────────────────────────────────────
  const [isCameraMode, setIsCameraMode] = useState(false);
  const [facingMode, setFacingMode] = useState("environment");
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (isCameraMode && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isCameraMode]);

  const provider = detectProvider();

  // ── Stop kamera — dipanggil di banyak titik ───────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraMode(false);
  }, []);

  // ── Start kamera ──────────────────────────────────────────
  const startCamera = useCallback(async (facing) => {
    const targetFacing = facing || facingMode;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Browser ini tidak mendukung akses kamera. Silakan gunakan upload foto.");
      return;
    }
    // Stop stream sebelumnya jika ada
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: targetFacing },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraMode(true);
      setError(null);
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setError("Akses kamera ditolak. Izinkan akses kamera di pengaturan browser, atau gunakan upload foto.");
      } else if (err.name === "NotFoundError") {
        setError("Tidak ada kamera yang ditemukan di perangkat ini. Silakan gunakan upload foto.");
      } else {
        setError("Gagal mengakses kamera: " + err.message + ". Silakan gunakan upload foto.");
      }
    }
  }, [facingMode]);

  // ── Capture frame dari video stream ────────────────────────
  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    // Jika kamera depan, mirror gambar saat capture
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    // Convert canvas ke Blob → File → processUserImage pipeline
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
      try {
        stopCamera();
        const processed = await processUserImage(file);
        setImgData(processed);
      } catch (err) {
        setError(err.message);
      }
    }, "image/jpeg", 0.92);
  }, [facingMode, stopCamera]);

  // ── Flip kamera (depan/belakang) ──────────────────────────
  const flipCamera = useCallback(() => {
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    startCamera(newFacing);
  }, [facingMode, startCamera]);

  // ── Lifecycle: stop kamera saat state berubah atau unmount ─
  useEffect(() => {
    if (uiState !== "idle") {
      stopCamera();
    }
    return () => stopCamera();
  }, [uiState, stopCamera]);

  // ── Reset ke state awal ───────────────────────────────────
  const reset = useCallback(() => {
    stopCamera();
    setUiState("idle");
    setImgData(null);
    setExtracted(null);
    setResult(null);
    setManualAir(150);
    setError(null);
  }, [stopCamera]);

  // ── Handle file input ─────────────────────────────────────
  const handleFile = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    try {
      const processed = await processUserImage(file);
      setImgData(processed);
    } catch (err) {
      setError(err.message);
    }
    e.target.value = "";
  }, []);

  // ── Scan: kirim ke AI dan routing hasil ──────────────────
  const scan = async () => {
    if (!imgData) return;
    stopCamera();
    setUiState("scanning");
    setError(null);

    try {
      const raw = await analyzeLabel(imgData.base64);
      setExtracted(raw);

      // ── Cek error dari AI ──────────────────────────────
      if (raw.error === "no_ing_table_found") {
        throw new Error(
          "Tabel Informasi Nilai Gizi tidak ditemukan dalam foto ini. " +
          "Pastikan kamu memfoto sisi kemasan yang memuat tabel ING."
        );
      }

      // ── Cek kelengkapan data minimum ──────────────────
      if (!raw.ukuran_sajian_nilai && raw.confidence_sajian !== "low") {
        throw new Error(
          "Ukuran sajian tidak terdeteksi. Pastikan teks 'Takaran Saji' " +
          "terlihat jelas dalam foto."
        );
      }

      // ── ROUTING: Cairan vs Serbuk ──────────────────────
      const isSerbuk = raw.satuan_saji === "g";

      if (!isSerbuk) {
        const r = calculateLiquid(raw);
        setResult(r);
        setUiState("result_liquid");
      } else {
        if (raw.volume_air_ml && raw.volume_air_ml > 0) {
          const r = calculatePowder(raw, raw.volume_air_ml);
          setResult(r);
          setUiState("result_powder");
        } else {
          setUiState("powder_interrupt");
        }
      }
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "AI tidak dapat membaca format label. Coba foto ulang dengan pencahayaan lebih baik dan tabel ING terlihat penuh."
          : err.message
      );
      setUiState("idle");
    }
  };

  // ── Handler Fase 2 Jalur A: foto petunjuk penyajian ──────
  const handlePowderPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUiState("scanning");
    try {
      const processed = await processUserImage(file);
      const raw2 = await analyzeLabel(processed.base64);
      const volAir = raw2.volume_air_ml;
      if (volAir && volAir > 0) {
        const r = calculatePowder(extracted, volAir);
        setResult(r);
        setUiState("result_powder");
      } else {
        setError("Petunjuk penyajian tidak ditemukan di foto ini. Coba input manual atau estimasi rentang.");
        setUiState("powder_interrupt");
      }
    } catch (err) {
      setError(err.message);
      setUiState("powder_interrupt");
    }
    e.target.value = "";
  };

  // ── Handler Fase 2 Jalur B: input manual volume air ──────
  const applyManualAir = () => {
    if (!extracted || !manualAir) return;
    try {
      const r = calculatePowder(extracted, manualAir);
      setResult(r);
      setUiState("result_powder");
    } catch (err) {
      setError(err.message);
    }
  };

  // ── Handler Fase 3: estimasi rentang ─────────────────────
  const applyRange = () => {
    if (!extracted) return;
    try {
      const r = calculatePowderRange(extracted);
      setResult(r);
      setUiState("result_range");
    } catch (err) {
      setError(err.message);
    }
  };

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div className={S.root} data-theme={isDark ? "dark" : "light"}>
      {/* ── Header ─────────────────────────────────────── */}
      <header className={S.header}>
        <div>
          <div className={S.headerTitle}>🥤 ScanGizi</div>
          <div className={S.headerSub}>Estimasi Nutri-Level · KMK HK.01.07/MENKES/301/2026</div>
        </div>
        <div className={S.headerRight}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className={S.themeToggle} onClick={toggleTheme} aria-label="Toggle theme">
              {isDark ? "☀️" : "🌙"}
            </button>
            {provider
              ? <span className={S.providerBadge}>✅ {PROVIDER_LABELS[provider.provider]}</span>
              : <span className={`${S.providerBadge} ${S.providerError}`}>⚠️ No API Key</span>
            }
          </div>
          {uiState !== "idle" && (
            <button className={S.resetBtn} onClick={reset}>← Mulai Ulang</button>
          )}
        </div>
      </header>

      <main className={S.main}>

        {/* ═══════════════════════════════════════════════
            IDLE — Upload / Kamera
        ═══════════════════════════════════════════════ */}
        {(uiState === "idle") && (
          <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
            {!provider && (
              <div className={S.alertBox}>
                <strong>⚠️ Belum ada API key</strong>
                <p>Salin <code>.env.example</code> → <code>.env</code>, isi API key, lalu <code>npm run dev</code>.</p>
              </div>
            )}

            <div className={S.sectionBadge}>📷 Foto Label ING</div>
            <h2 className={S.cardTitle}>Scan Informasi Nilai Gizi</h2>
            <p className={S.cardDesc}>
              Foto bagian <strong>tabel Informasi Nilai Gizi</strong> di kemasan minuman.
              Pastikan seluruh tabel terlihat jelas dan tidak buram.
            </p>

            {/* ── Mode Kamera Aktif ─────────────────────── */}
            {isCameraMode ? (
              <>
                <div className={S.cameraContainer}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`${S.cameraVideo} ${facingMode === "user" ? S.cameraVideoFront : ""}`}
                  />
                </div>
                <div className={S.cameraControls}>
                  <button className={S.closeCameraBtn} onClick={stopCamera} aria-label="Tutup kamera">
                    ✕
                  </button>
                  <button className={S.shutterBtn} onClick={captureFrame} aria-label="Ambil foto" />
                  <button className={S.flipBtn} onClick={flipCamera} aria-label="Ganti kamera">
                    🔄
                  </button>
                </div>
                <div className={S.cameraHint}>
                  Arahkan kamera ke tabel Informasi Nilai Gizi, lalu tekan tombol capture.
                </div>
              </>
            ) : (
              <>
                {/* Drop zone */}
                <div className={`${S.dropZone} ${imgData ? S.dropHasImg : S.dropZoneIdle}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f?.type.startsWith("image/")) {
                      const dt = new DataTransfer(); dt.items.add(f);
                      fileRef.current.files = dt.files;
                      handleFile({ target: { files: dt.files, value: "" } });
                    }
                  }}>
                  {imgData
                    ? <img src={imgData.dataUrl} className={S.preview} alt="Preview label ING" />
                    : <>
                        <span className={S.dropIcon}>📸</span>
                        <span className={S.dropTitle}>Ketuk untuk foto / pilih gambar</span>
                        <span className={S.dropHint}>Arahkan ke tabel ING · JPG, PNG, atau langsung dari kamera</span>
                      </>
                  }
                </div>

                <input ref={fileRef} type="file" accept="image/*" capture="environment"
                  onChange={handleFile} style={{ display: "none" }} />

                {imgData ? (
                  <button className={S.btnGhost} onClick={() => {
                    setImgData(null);
                    fileRef.current?.click();
                  }}>🔄 Ganti foto</button>
                ) : (
                  <button className={S.cameraOpenBtn} onClick={() => startCamera()}>
                    📷 Buka Kamera Langsung
                  </button>
                )}
              </>
            )}

            <div style={{ height: 10 }} />

            <button className={S.btnPrimary}
              disabled={!imgData || !provider || isCameraMode}
              onClick={scan}>
              🔬 Analisis Nutri-Level
            </button>

            {error && <div className={S.errBox}>⚠️ {error}</div>}

            <div className={S.infoBox}>
              ℹ️ Request dikirim langsung dari browser ke <strong>{provider ? PROVIDER_LABELS[provider.provider] : "—"}</strong>.
              Metadata EXIF (GPS, device ID) dihapus otomatis sebelum upload.
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════════
            SCANNING — Loading
        ═══════════════════════════════════════════════ */}
        {uiState === "scanning" && (
          <section className={`${S.card} ${S.centerCard}`}>
            <div className={S.spinnerEmoji}>🔬</div>
            <div className={S.spinnerTitle}>Menganalisis label ING...</div>
            <div className={S.spinnerSub}>AI sedang membaca tabel dan mengekstrak nilai gizi</div>
            <div className={S.spinnerDots}>
              <span /><span /><span />
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════════
            POWDER INTERRUPT — Fase 2: Produk Serbuk
        ═══════════════════════════════════════════════ */}
        {uiState === "powder_interrupt" && extracted && (
          <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
            <div className={S.sectionBadge} style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}>
              📦 Produk Serbuk Terdeteksi
            </div>

            <h2 className={S.cardTitle}>Perlu Info Tambahan</h2>
            <p className={S.cardDesc}>
              Produk ini tampaknya minuman serbuk yang harus diseduh.
              Takaran saji tercatat <strong>{extracted.ukuran_sajian_nilai}g</strong> — untuk
              kalkulasi yang akurat, kami perlu tahu volume air penyeduh.
            </p>

            {/* Data yang sudah berhasil diekstrak */}
            <div className={S.extractedBox}>
              <div className={S.sectionLabel}>✅ Data yang berhasil dibaca</div>
              {extracted.nama_produk && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{extracted.nama_produk}</div>}
              <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                <span>Gula: <strong>{extracted.total_gula_g}g</strong></span>
                <span>Natrium: <strong>{extracted.natrium_mg}mg</strong></span>
                <span>Lemak Jenuh: <strong>{extracted.lemak_jenuh_g}g</strong></span>
              </div>
            </div>

            {error && <div className={S.errBox} style={{ marginBottom: 12 }}>⚠️ {error}</div>}

            {/* ── Jalur A: Foto petunjuk penyajian ────── */}
            <div className={S.jalurCard}>
              <div className={S.jalurTitle}>📸 Jalur A — Foto Petunjuk Penyajian</div>
              <p className={S.jalurDesc}>
                Cari teks seperti <em>"Seduh dengan 150ml air panas"</em> di kemasan.
                Biasanya ada di sisi atau bawah kemasan.
              </p>
              <input
                type="file" accept="image/*" capture="environment"
                ref={powderPhotoRef}
                onChange={handlePowderPhoto}
                style={{ display: "none" }} />
              <button className={S.btnOutline}
                onClick={() => powderPhotoRef.current?.click()}>
                📷 Foto Sisi Lain Kemasan
              </button>
            </div>

            {/* ── Jalur B: Input manual ────────────────── */}
              <div className={S.jalurCard}>
                <div className={S.jalurTitle}>✏️ Jalur B — Input Volume Air Manual</div>
                <p className={S.jalurDesc}>
                  Kamu tahu berapa air yang digunakan? Masukkan di sini.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="number" min={50} max={1000} step={10}
                    value={manualAir}
                    onChange={e => setManualAir(parseInt(e.target.value) || 150)}
                    className={S.numInput}
                  />
                  <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>ml air</span>
                  <button className={S.btnPrimarySmall} onClick={applyManualAir}>
                    Hitung →
                  </button>
                </div>
                {/* Preset cepat */}
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {[100, 150, 200, 250].map(v => (
                    <button key={v} className={S.presetBtn}
                      style={{ background: manualAir === v ? "var(--accent-primary)" : "", color: manualAir === v ? "#fff" : "" }}
                      onClick={() => setManualAir(v)}>{v}ml</button>
                  ))}
                </div>
              </div>

            {/* ── Jalur C / Fase 3: Estimasi Rentang ─── */}
            <div className={S.jalurCard} style={{ borderColor: "var(--border-primary)" }}>
              <div className={S.jalurTitle}>⚡ Jalur C — Estimasi Rentang Cepat</div>
              <p className={S.jalurDesc}>
                Tampilkan dua skenario (pekat & encer) berdasarkan standar umum.
                Hasilnya indikatif, bukan akurat — cocok untuk gambaran cepat.
              </p>
              <button className={S.btnGhostSmall} onClick={applyRange}>
                Lihat Estimasi Rentang →
              </button>
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════════
            RESULT LIQUID — Hasil Produk Cairan
        ═══════════════════════════════════════════════ */}
        {uiState === "result_liquid" && result && (() => {
          const ls = LEVEL_CONFIG[result.level];
          return (
            <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
              <div className={S.resultHero} style={{ background: `linear-gradient(135deg, ${ls.bg}, ${ls.bg}88)` }} />
              <div className={S.sectionBadge} style={{ background: ls.light, color: ls.dark }}>
                ✅ Hasil Estimasi
              </div>

              {result.namaProduk && (
                <div style={{ marginBottom: 6 }}>
                  <div className={S.productLabel}>Produk</div>
                  <div className={S.productName}>{result.namaProduk}</div>
                </div>
              )}
              <div className={S.productMeta}>
                Ukuran sajian: <strong>{result.sajiMl} ml</strong>
                <span style={{ marginLeft: 10 }}><ConfidenceBadge level={result.confidence} /></span>
              </div>

              <div className={S.divider} />

              {/* NL bar */}
              <div style={{ textAlign: "center" }}>
                <div className={S.sectionLabel}>Nutri-Level</div>
                <NutriBar activeLevel={result.level} />
                <div className={S.nlPill} style={{ background: ls.light, color: ls.dark }}>
                  Level {result.level} — {ls.label}
                </div>
                {result.penentu && (
                  <p className={S.penentuText}>
                    Ditentukan oleh: <strong style={{ color: ls.dark }}>{result.penentu.name}</strong>
                  </p>
                )}
              </div>

              <div className={S.divider} />
              <div className={S.sectionLabel}>Detail per 100 ml</div>
              <ComponentRows components={result.components} />

              {/* Reasoning debug (tampil jika confidence rendah) */}
              {result.confidence !== "high" && extracted?.reasoning && (
                <details className={S.reasoningBox}>
                  <summary>ℹ️ Catatan AI</summary>
                  <p>{extracted.reasoning}</p>
                </details>
              )}

              <div style={{ height: 14 }} />
              <button className={S.btnOutline} onClick={reset}>📷 Scan Produk Lain</button>
              <p className={S.disclaimer}>
                ⚠️ Estimasi berdasarkan label ING yang terdeteksi AI —
                bukan klaim resmi Nutri-Level Kemenkes RI (KMK HK.01.07/MENKES/301/2026).
              </p>
            </section>
          );
        })()}

        {/* ═══════════════════════════════════════════════
            RESULT POWDER — Hasil Serbuk (volume diketahui)
        ═══════════════════════════════════════════════ */}
        {uiState === "result_powder" && result && (() => {
          const ls = LEVEL_CONFIG[result.level];
          return (
            <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
              <div className={S.resultHero} style={{ background: `linear-gradient(135deg, ${ls.bg}, ${ls.bg}88)` }} />
              <div className={S.sectionBadge} style={{ background: ls.light, color: ls.dark }}>
                ✅ Hasil Estimasi — Produk Serbuk
              </div>

              {result.namaProduk && (
                <div style={{ marginBottom: 6 }}>
                  <div className={S.productLabel}>Produk</div>
                  <div className={S.productName}>{result.namaProduk}</div>
                </div>
              )}
              <div className={S.productMeta}>
                {result.sajiG}g serbuk + {result.volumeAirMl}ml air
                = <strong>{result.volumeTotal}ml minuman jadi</strong>
              </div>

              <div className={S.divider} />

              <div style={{ textAlign: "center" }}>
                <div className={S.sectionLabel}>Nutri-Level</div>
                <NutriBar activeLevel={result.level} />
                <div className={S.nlPill} style={{ background: ls.light, color: ls.dark }}>
                  Level {result.level} — {ls.label}
                </div>
                {result.penentu && (
                  <p className={S.penentuText}>
                    Ditentukan oleh: <strong style={{ color: ls.dark }}>{result.penentu.name}</strong>
                  </p>
                )}
              </div>

              <div className={S.divider} />
              <div className={S.sectionLabel}>Detail per 100 ml minuman jadi</div>
              <ComponentRows components={result.components} />

              <div style={{ height: 14 }} />
              <button className={S.btnOutline} onClick={reset}>📷 Scan Produk Lain</button>
              <p className={S.disclaimer}>
                ⚠️ Estimasi berdasarkan label ING + volume air yang diinput.
                Hasil aktual bisa berbeda tergantung cara penyajian.
              </p>
            </section>
          );
        })()}

        {/* ═══════════════════════════════════════════════
            RESULT RANGE — Fase 3: Estimasi Rentang
        ═══════════════════════════════════════════════ */}
        {uiState === "result_range" && result && (
          <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
            <div className={S.sectionBadge} style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}>
              ⚡ Estimasi Rentang — Fase 3
            </div>

            <h2 className={S.cardTitle}>
              {result.namaProduk || "Produk Serbuk"}
            </h2>
            <p className={S.cardDesc}>
              Karena volume air tidak diketahui, sistem menampilkan <strong>dua skenario</strong>.
              Hasil aktual bergantung pada cara penyajian.
            </p>

            <div className={S.warningBox}>
              ⚠️ <strong>Akurasi rendah</strong> — ini adalah estimasi kasar berdasarkan
              asumsi standar untuk kategori <em>{result.rangeLabel}</em>.
              Untuk hasil akurat, gunakan Jalur A atau B.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
              <SkenarioCard
                sk={result.skenarioPekat}
                label="🔴 Skenario Pekat (lebih konservatif)"
              />
              <SkenarioCard
                sk={result.skenarioEncer}
                label="🟢 Skenario Encer (lebih optimistis)"
              />
            </div>

            <div className={S.rangeInsight}>
              💡 <strong>Mengapa dua skenario?</strong> Menampilkan satu angka pasti
              untuk data yang tidak kita ketahui akan menciptakan <em>false precision</em> —
              kepercayaan diri semu yang bisa menyesatkan. Rentang ini lebih jujur
              tentang ketidakpastian yang ada.
            </div>

            <div style={{ height: 14 }} />
            <button className={S.btnOutline}
              onClick={() => { setUiState("powder_interrupt"); setError(null); }}>
              ← Coba Jalur A atau B
            </button>
            <button className={S.btnGhost} onClick={reset} style={{ marginTop: 6 }}>
              📷 Scan Produk Lain
            </button>
            <p className={S.disclaimer}>
              ⚠️ Estimasi kasar — bukan klaim resmi Nutri-Level Kemenkes RI.
            </p>
          </section>
        )}

        {/* ── Tabel Referensi Threshold ─────────────────── */}
        {(uiState === "idle") && (
          <section className={`${S.card} ${S.threshCard}`}>
            <div className={S.sectionLabel}>Tabel Ambang Batas per 100 ml · KMK 301/2026</div>
            <table className={S.threshTable}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Zat Gizi</th>
                  {LEVELS.map(l => (
                    <th key={l} style={{ color: LEVEL_CONFIG[l].bg, textAlign: "center" }}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {THRESH.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 1 ? "var(--thresh-row-alt)" : "transparent" }}>
                    <td>{row.name}</td>
                    {["A","B","C","D"].map(l => (
                      <td key={l} style={{ textAlign: "center" }}>{row[l]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={S.threshNote}>
              Level akhir = komponen terburuk. Gula dihitung tanpa laktosa (Lampiran A poin 5).
            </p>
          </section>
        )}

      </main>

      <footer className={S.footer}>
        ScanGizi · Estimasi berbasis AI · Sumber: KMK HK.01.07/MENKES/301/2026
      </footer>

      <style>{`
        @keyframes slideUp {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </div>
  );
}
