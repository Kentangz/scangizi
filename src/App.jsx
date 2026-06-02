/**
 * App.jsx — ScanGizi
 * ─────────────────────────────────────────────────────────────
 * React main application managing state machines and UI flow:
 *
 * STATES:
 *  "idle"            -> Initial upload/camera capture screen
 *  "scanning"        -> AI processing screen
 *  "result_liquid"   -> Nutrition estimation for liquid products
 *  "powder_interrupt"-> User interaction screen for powder products
 *  "result_powder"   -> Calculation results for powder products
 *  "result_range"    -> Skenario estimation range (minimum & maximum water)
 *  "error"           -> Unrecoverable error screen
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { analyzeLabel, getActiveProvider, detectProvider, PROVIDER_LABELS } from "./api.js";
import { processUserImage, FileValidationError } from "./imageUtils.js";
import {
  calculateLiquid, calculatePowder, calculatePowderRange,
  LEVELS, LEVEL_CONFIG,
} from "./nutriLevel.js";
import S from "./App.module.css";

// Reference nutrition threshold table values
const THRESH = [
  { name: "Gula (g)",          A: "≤1",   B: "1–5",    C: "5–10",   D: ">10"  },
  { name: "Garam / Na (mg)",   A: "≤5",   B: "5–120",  C: "120–500",D: ">500" },
  { name: "Lemak Jenuh (g)",   A: "≤0.7", B: "0.7–1.2",C: "1.2–2.8",D: ">2.8"},
];

const COMP_MAX = { gula: 12, garam: 600, lemak: 3.5 };
const COMP_KEYS = ["gula", "garam", "lemak"];

// --- Sub-component: Nutrition Bar (Pip Bar Level A–D) ---
function NutriBar({ activeLevel }) {
  return (
    <>
      <div className={S.nlBar}>
        {LEVELS.map(l => {
          const cfg = LEVEL_CONFIG[l];
          const isActive = l === activeLevel;
          return (
            <div
              key={l}
              className={`${S.nlPip} ${isActive ? S.nlPipActive : ""}`}
              style={{ background: cfg.bg }}
            />
          );
        })}
      </div>
      <div className={S.nlLabelRow}>
        {LEVELS.map(l => {
          const cfg = LEVEL_CONFIG[l];
          const isActive = l === activeLevel;
          return (
            <span
              key={l}
              className={`${S.nlLabelItem} ${isActive ? S.nlLabelItemActive : ""}`}
              style={isActive ? { color: cfg.bg } : {}}
            >
              {l}
            </span>
          );
        })}
      </div>
    </>
  );
}

// --- Sub-component: Component Rows (Nutrition detail rows with progress bars) ---
function ComponentRows({ components }) {
  return components.map((c, i) => {
    const cfg = LEVEL_CONFIG[c.level];
    const maxVal = COMP_MAX[COMP_KEYS[i]] ?? 1;
    const pct = Math.min(100, (c.value / maxVal) * 100);

    return (
      <div key={i} className={S.compRow}>
        <div className={S.compLeft}>
          <div className={S.compName}>{c.name}</div>
          <div className={S.compVal}>
            <span className={S.compValNum}>{c.value}</span> {c.unit}/100ml
          </div>
          {c.note && <div className={S.compNote}>{c.note}</div>}
          <div className={S.compBar}>
            <div
              className={S.compBarFill}
              style={{ width: `${pct}%`, background: cfg.bg }}
            />
          </div>
          <div className={S.compThresh}>{c.threshold}</div>
        </div>
        <span className={S.levelPill} style={{ background: cfg.bg }}>{c.level}</span>
      </div>
    );
  });
}

// --- Sub-component: SkenarioCard (Used in range estimate view) ---
function SkenarioCard({ sk, label }) {
  const cfg = LEVEL_CONFIG[sk.level];
  return (
    <div className={S.skenarioCard} style={{ borderColor: cfg.bg }}>
      <div className={S.skenarioHeader} style={{ background: cfg.light ?? cfg.bg + '20' }}>
        <div className={S.skenarioHeaderLeft}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{sk.label}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div className={S.skenarioHeaderBadge} style={{ background: cfg.bg }}>
            {sk.level}
          </div>
          <div className={S.skenarioLevelLabel} style={{ color: cfg.bg }}>{cfg.label}</div>
        </div>
      </div>
      <div className={S.skenarioBody}>
        {sk.components.map((c, i) => (
          <div key={i} className={S.skenarioRow}>
            <span style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
            <span>
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {c.value} {c.unit}/100ml
              </strong>
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

// --- Sub-component: Confidence Badge ---
function ConfidenceBadge({ level }) {
  const cfg = {
    high:   { bg: "var(--success-bg)",  color: "var(--success-text)",  label: "Akurasi Tinggi"  },
    medium: { bg: "var(--warning-bg)",  color: "var(--warning-text)",  label: "Akurasi Sedang"  },
    low:    { bg: "var(--error-bg)",    color: "var(--error-text)",    label: "Akurasi Rendah"  },
  }[level] ?? { bg: "var(--bg-input)", color: "var(--text-tertiary)", label: "Tidak diketahui" };
  return (
    <span className={S.confidenceBadge} style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

// --- Main App Component ---
export default function App() {
  const [uiState,   setUiState]   = useState("idle");
  const [imgData,   setImgData]   = useState(null);    // { dataUrl, base64 }
  const [extracted, setExtracted] = useState(null);    // Raw AI JSON response
  const [result,    setResult]    = useState(null);    // Nutri-level calculation output
  const [manualAir, setManualAir] = useState(150);     // User input for water volume (ml)
  const [error,     setError]     = useState(null);
  const [zoomImage, setZoomImage] = useState(null);    // State for image lightbox zoom
  const galleryRef     = useRef(null);
  const powderPhotoRef = useRef(null);

  // Theme Management
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem("scangizi-theme");
      return saved ? saved === "dark" : true;
    } catch { return true; }
  });

  // Example photo
  const [exampleOpen, setExampleOpen] = useState(false);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      try { localStorage.setItem("scangizi-theme", next ? "dark" : "light"); } catch {}
      return next;
    });
  }, []);

  // Camera Management
  const [isCameraMode, setIsCameraMode] = useState(false);
  const [facingMode, setFacingMode] = useState("environment");
  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (isCameraMode && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isCameraMode]);

  const [provider, setProvider] = useState(() => {
    const local = detectProvider();
    return local ? { provider: local.provider, isProxy: false } : null;
  });
  const [isCheckingProvider, setIsCheckingProvider] = useState(true);

  useEffect(() => {
    getActiveProvider().then(result => {
      if (result) setProvider(result);
      setIsCheckingProvider(false);
    });
  }, []);

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

  const startCamera = useCallback(async (facing) => {
    const targetFacing = facing || facingMode;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Browser ini tidak mendukung akses kamera. Silakan gunakan upload foto.");
      return;
    }
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

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
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

  const flipCamera = useCallback(() => {
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    startCamera(newFacing);
  }, [facingMode, startCamera]);

  // Handle camera teardown on screen change
  useEffect(() => {
    if (uiState !== "idle") {
      stopCamera();
    }
    return () => stopCamera();
  }, [uiState, stopCamera]);

  // Reset to initial application state
  const reset = useCallback(() => {
    stopCamera();
    setUiState("idle");
    setImgData(null);
    setExtracted(null);
    setResult(null);
    setManualAir(150);
    setError(null);
  }, [stopCamera]);

  // Handle image upload input
  const handleFile = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    try {
      const processed = await processUserImage(file);
      setImgData(processed);
    } catch (err) {
      setError(err instanceof FileValidationError ? err.userMessage : err.message);
    }
    e.target.value = "";
  }, []);

  // Main scan action to call AI and route the navigation
  const scan = async () => {
    if (!imgData) return;
    stopCamera();
    setUiState("scanning");
    setError(null);

    try {
      const raw = await analyzeLabel(imgData.base64);
      setExtracted(raw);

      if (raw.error === "no_ing_table_found") {
        throw new Error(
          "Tabel Informasi Nilai Gizi tidak ditemukan dalam foto ini. " +
          "Pastikan kamu memfoto sisi kemasan yang memuat tabel ING."
        );
      }

      if (!raw.ukuran_sajian_nilai && raw.confidence_sajian !== "low") {
        throw new Error(
          "Ukuran sajian tidak terdeteksi. Pastikan teks 'Takaran Saji' " +
          "terlihat jelas dalam foto."
        );
      }

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

  // Powder Flow Option A: Scan serving instruction side
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
      if (err instanceof FileValidationError) {
        setError(err.userMessage);
        setUiState("powder_interrupt");
      } else {
        setError(err.message);
        setUiState("powder_interrupt");
      }
    }
    e.target.value = "";
  };

  // Powder Flow Option B: Manual serving water volume input
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

  // Powder Flow Option C: Double scenario range estimation
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

  return (
    <div className={S.root} data-theme={isDark ? "dark" : "light"}>
      {/* Header */}
      <header className={S.header}>
        <div className={S.headerLogo}>
          <div className={S.headerLogoIcon}>🥤</div>
          <div>
            <div className={S.headerTitle}>ScanGizi</div>
            <div className={S.headerSub}>KMK HK.01.07/MENKES/301/2026</div>
          </div>
        </div>
        <div className={S.headerRight}>
          <div className={S.headerActions}>
            <button className={S.themeToggle} onClick={toggleTheme} aria-label="Toggle tema">
              <i className={`ti ti-${isDark ? "sun" : "moon"}`} aria-hidden="true" />
            </button>
            {isCheckingProvider && !provider
              ? <span className={S.providerBadge} style={{ opacity: 0.6 }}>Memeriksa...</span>
              : provider
                ? <span className={S.providerBadge}>✓ {PROVIDER_LABELS[provider.provider]}</span>
                : <span className={`${S.providerBadge} ${S.providerError}`}>✕ No API Key</span>
            }
          </div>
          {uiState !== "idle" && (
            <button className={S.resetBtn} onClick={reset}>
              <i className="ti ti-arrow-left" style={{ fontSize: 11 }} aria-hidden="true" />
              Mulai Ulang
            </button>
          )}
        </div>
      </header>

      <main className={S.main}>

        {/* =======================================================
            IDLE STATE — Upload & Camera Interface
            ======================================================= */}
        {(uiState === "idle") && (
          <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
            {!isCheckingProvider && !provider && (
              <div className={S.alertBox}>
                <strong>⚠️ Belum ada API key</strong>
                <p>Salin <code>.env.example</code> → <code>.env</code>, isi API key, lalu restart server.</p>
              </div>
            )}

            <div className={S.sectionBadge}>
              <i className="ti ti-scan" style={{ fontSize: 12 }} aria-hidden="true" />
              Foto Label ING
            </div>
            <h2 className={S.cardTitle}>Scan Informasi Nilai Gizi</h2>
            <p className={S.cardDesc}>
              Foto bagian <strong>tabel Informasi Nilai Gizi</strong> di kemasan minuman.
              Pastikan seluruh tabel terlihat jelas dan tidak buram.
            </p>

            {/* ── Examples of Collapsible Photos ─────────────────────── */}
            <details
              className={S.exampleBox}
              open={exampleOpen}
              onToggle={(e) => {
                setExampleOpen(e.currentTarget.open);
              }}
            >
              <summary className={S.exampleBoxSummary}>
                <i className="ti ti-photo" style={{ fontSize: 14, color: "var(--accent-primary)", flexShrink: 0 }} aria-hidden="true" />
                <span className={S.exampleBoxSummaryText}>Contoh foto yang benar</span>
                <span className={S.exampleBoxSummaryBadge}>Panduan</span>
                <i className={`ti ti-chevron-right ${S.exampleBoxChevron}`} style={{ fontSize: 13 }} aria-hidden="true" />
              </summary>
              <div className={S.exampleBoxBody}>
                <div className={S.exampleImgWrapper} onClick={() => setZoomImage("/contoh-ing.webp")}>
                  <img
                    src="/contoh-ing.webp"
                    alt="Contoh foto tabel ING — seluruh tabel terlihat jelas, tidak buram, tidak terpotong"
                    className={S.exampleImg}
                  />
                </div>
                <div className={S.exampleChecklist}>
                  {[
                    "Seluruh tabel terlihat",
                    "Teks terbaca jelas",
                    "Tidak buram",
                    "Tidak terpotong",
                  ].map((item) => (
                    <span key={item} className={S.exampleCheckItem}>
                      <i className="ti ti-check" style={{ fontSize: 10 }} aria-hidden="true" />
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </details>
            {/* ────────────────────────────────────────────────── */}

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
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                  <button className={S.shutterBtn} onClick={captureFrame} aria-label="Ambil foto" />
                  <button className={S.flipBtn} onClick={flipCamera} aria-label="Ganti kamera">
                    <i className="ti ti-camera-rotate" aria-hidden="true" />
                  </button>
                </div>
                <div className={S.cameraHint}>
                  Arahkan kamera ke tabel Informasi Nilai Gizi, lalu tekan tombol capture.
                </div>
              </>
            ) : (
              <>
                <div
                  className={`${S.dropZone} ${imgData ? S.dropHasImg : S.dropZoneIdle}`}
                  onClick={() => galleryRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f?.type.startsWith("image/")) {
                      handleFile({ target: { files: e.dataTransfer.files, value: "" } });
                    }
                  }}
                >
                  {!imgData && (
                    <>
                      <div className={S.dropZoneGrid} aria-hidden="true" />
                      <div className={`${S.cornerBracket} ${S.cornerTL}`} aria-hidden="true" />
                      <div className={`${S.cornerBracket} ${S.cornerTR}`} aria-hidden="true" />
                      <div className={`${S.cornerBracket} ${S.cornerBL}`} aria-hidden="true" />
                      <div className={`${S.cornerBracket} ${S.cornerBR}`} aria-hidden="true" />
                    </>
                  )}

                  {imgData
                    ? <div className={S.previewWrapper} onClick={(e) => {
                        e.stopPropagation();
                        setZoomImage(imgData.dataUrl);
                      }}>
                        <img src={imgData.dataUrl} className={S.preview} alt="Preview label ING" />
                      </div>
                    : <>
                        <div className={S.dropIcon}>
                          <i className="ti ti-scan" style={{ fontSize: 26, color: "var(--accent-primary)" }} aria-hidden="true" />
                        </div>
                        <span className={S.dropTitle}>Ketuk untuk foto label ING</span>
                        <span className={S.dropHint}>Arahkan ke tabel Informasi Nilai Gizi · JPG, PNG, WebP</span>
                      </>
                  }
                </div>

                <input ref={galleryRef} type="file" accept="image/*"
                  onChange={handleFile} style={{ display: "none" }} />

                {imgData ? (
                  <button className={S.btnGhost} onClick={() => {
                    setImgData(null);
                    galleryRef.current?.click();
                  }}>
                    <i className="ti ti-refresh" style={{ fontSize: 13 }} aria-hidden="true" /> Ganti foto
                  </button>
                ) : (
                  <button className={S.cameraOpenBtn} onClick={() => startCamera()}>
                    <i className="ti ti-camera" style={{ fontSize: 15 }} aria-hidden="true" />
                    Buka Kamera Langsung
                  </button>
                )}
              </>
            )}

            <div style={{ height: 10 }} />

            <button className={S.btnPrimary}
              disabled={!imgData || (!provider && !isCheckingProvider) || isCameraMode}
              onClick={scan}>
              <i className="ti ti-microscope" style={{ fontSize: 16 }} aria-hidden="true" />
              Analisis Nutri-Level
            </button>

            {error && (
              <div className={S.errBox}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className={S.infoBox}>
              <i className="ti ti-shield-check" style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <span>
                {provider?.isProxy
                  ? "Request diproses secara aman via Serverless Proxy ke "
                  : "Request dikirim langsung dari browser ke "
                }<strong>{provider ? PROVIDER_LABELS[provider.provider] : "—"}</strong>.
                Metadata EXIF (GPS, device ID) dihapus otomatis sebelum upload.
              </span>
            </div>
          </section>
        )}

        {/* =======================================================
            SCANNING STATE — Loading Screen with Decorative Steps
            ======================================================= */}
        {uiState === "scanning" && (
          <section className={`${S.card} ${S.centerCard}`}>
            <div className={S.scanAnimWrapper}>
              <div className={S.scanLine} aria-hidden="true" />
              <div className={S.scanOverlay} aria-hidden="true" />
              <span style={{ fontSize: 38, position: "relative", zIndex: 1 }}>🥤</span>
            </div>
            <div className={S.spinnerTitle}>Membaca label ING...</div>
            <div className={S.spinnerSub}>
              AI sedang mengekstrak data nilai gizi<br />dari foto yang kamu upload
            </div>
            <div className={S.spinnerDots}>
              <span /><span /><span />
            </div>
            <div className={S.stepList}>
              <span className={S.sectionLabel}>Langkah Analisis</span>
              {[
                { label: "Deteksi tabel ING", done: true },
                { label: "Ekstrak takaran saji", done: true },
                { label: "Baca nilai GGL", done: false },
                { label: "Validasi & kalkulasi", done: false },
              ].map((step, i) => (
                <div key={i} className={S.stepItem}>
                  <div className={`${S.stepDot} ${step.done ? S.stepDotDone : S.stepDotPending}`}>
                    {step.done
                      ? <i className="ti ti-check" style={{ fontSize: 10 }} aria-hidden="true" />
                      : <span style={{ fontSize: 9 }}>○</span>
                    }
                  </div>
                  <span className={step.done ? S.stepTextDone : S.stepTextPending}>{step.label}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* =======================================================
            POWDER INTERRUPT STATE — Serving Water Options Screen
            ======================================================= */}
        {uiState === "powder_interrupt" && extracted && (
          <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
            <div className={S.powderBanner}>
              <i className="ti ti-package" style={{ fontSize: 20, color: 'var(--warning-text)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Produk Serbuk Terdeteksi</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Takaran saji <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{extracted.ukuran_sajian_nilai}g</strong>.
                  Perlu info volume air penyeduh untuk akurasi optimal.
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: '9px 11px' }}>
              <span className={S.sectionLabel}>✓ Data yang berhasil dibaca</span>
              {extracted.nama_produk && (
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 5 }}>
                  {extracted.nama_produk}
                </div>
              )}
              <div style={{ display: 'flex', gap: '6px 12px', fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                <span>Gula: <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{extracted.total_gula_g}g</strong></span>
                <span>Na: <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{extracted.natrium_mg}mg</strong></span>
                <span>LJ: <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{extracted.lemak_jenuh_g}g</strong></span>
              </div>
            </div>

            {error && (
              <div className={S.errBox}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Option A: Photo Serving Side */}
            <div className={S.jalurCard}>
              <div className={S.jalurHeader}>
                <div className={S.jalurColorBar} style={{ background: "#3B82F6" }} />
                <i className="ti ti-camera" style={{ fontSize: 15, color: "#3B82F6", flexShrink: 0 }} aria-hidden="true" />
                <div className={S.jalurTitle}>Jalur A — Foto Petunjuk Penyajian</div>
              </div>
              <div className={S.jalurBody}>
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
                  <i className="ti ti-camera" style={{ fontSize: 15 }} aria-hidden="true" />
                  Foto Sisi Lain Kemasan
                </button>
              </div>
            </div>

            {/* Option B: Manual Input */}
            <div className={S.jalurCard}>
              <div className={S.jalurHeader}>
                <div className={S.jalurColorBar} style={{ background: "#8B5CF6" }} />
                <i className="ti ti-pencil" style={{ fontSize: 15, color: "#8B5CF6", flexShrink: 0 }} aria-hidden="true" />
                <div className={S.jalurTitle}>Jalur B — Input Volume Air Manual</div>
              </div>
              <div className={S.jalurBody}>
                <p className={S.jalurDesc}>Kamu tahu berapa air yang digunakan? Masukkan di sini.</p>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="number" min={50} max={1000} step={10}
                    value={manualAir}
                    onChange={e => setManualAir(parseInt(e.target.value) || 150)}
                    className={S.numInput}
                  />
                  <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>ml air</span>
                  <button className={S.btnPrimarySmall} onClick={applyManualAir}>Hitung →</button>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {[100, 150, 200, 250].map(v => (
                    <button key={v}
                      className={`${S.presetBtn} ${manualAir === v ? S.presetBtnActive : ""}`}
                      onClick={() => setManualAir(v)}>
                      {v}ml
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Option C: Range Estimate */}
            <div className={S.jalurCard}>
              <div className={S.jalurHeader}>
                <div className={S.jalurColorBar} style={{ background: "#F59E0B" }} />
                <i className="ti ti-bolt" style={{ fontSize: 15, color: "#F59E0B", flexShrink: 0 }} aria-hidden="true" />
                <div className={S.jalurTitle}>Jalur C — Estimasi Rentang Cepat</div>
              </div>
              <div className={S.jalurBody}>
                <p className={S.jalurDesc}>
                  Tampilkan dua skenario (pekat &amp; encer) berdasarkan standar umum.
                  Hasilnya indikatif, bukan akurat — cocok untuk gambaran cepat.
                </p>
                <button className={S.btnGhostSmall} onClick={applyRange}>
                  Lihat Estimasi Rentang →
                </button>
              </div>
            </div>
          </section>
        )}

        {/* =======================================================
            RESULT LIQUID STATE — Calculation Output for Liquid Drinks
            ======================================================= */}
        {uiState === "result_liquid" && result && (() => {
          const ls = LEVEL_CONFIG[result.level];
          return (
            <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
              <div className={S.resultHero} style={{ background: `linear-gradient(135deg, ${ls.bg}, ${ls.bg}88)` }} />

              <div className={S.levelHeroCard} style={{ background: ls.bg + '20' }}>
                <div className={S.levelHeroBg} style={{ background: ls.bg + '14' }} />
                <span className={S.sectionBadge} style={{ background: ls.bg + '20', color: ls.bg, position: 'relative', zIndex: 1 }}>
                  ✓ Estimasi Nutri-Level
                </span>
                <div className={S.levelBigBadge} style={{ background: ls.bg }}>
                  {result.level}
                </div>
                <div className={S.levelName} style={{ color: 'var(--text-primary)' }}>{ls.label}</div>
                <div className={S.levelDesc} style={{ color: ls.bg }}>{ls.desc}</div>
                <NutriBar activeLevel={result.level} />
              </div>

              <div className={S.productInfoBar}>
                <span className={S.productEmoji}>🧃</span>
                <div>
                  <div className={S.productName}>{result.namaProduk || "Minuman"}</div>
                  <div className={S.productMeta}>
                    Sajian {result.sajiMl} ml
                    <span style={{ marginLeft: 4 }}><ConfidenceBadge level={result.confidence} /></span>
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: '10px 12px' }}>
                <span className={S.sectionLabel}>Detail per 100 ml</span>
                <ComponentRows components={result.components} />
              </div>

              {result.penentu && (
                <div className={S.penentuBox} style={{ background: ls.bg + '1A', border: `1px solid ${ls.bg}30` }}>
                  <i className="ti ti-info-circle" style={{ fontSize: 15, color: ls.bg, flexShrink: 0 }} aria-hidden="true" />
                  <span>
                    Ditentukan oleh <strong style={{ color: 'var(--text-primary)' }}>{result.penentu.name}</strong> — komponen dengan level tertinggi
                  </span>
                </div>
              )}

              {result.confidence !== "high" && extracted?.reasoning && (
                <details className={S.reasoningBox}>
                  <summary>Catatan AI</summary>
                  <p>{extracted.reasoning}</p>
                </details>
              )}

              <div style={{ height: 6 }} />
              <button className={S.btnOutline} onClick={reset}>
                <i className="ti ti-camera" style={{ fontSize: 15 }} aria-hidden="true" />
                Scan Produk Lain
              </button>
              <p className={S.disclaimer}>
                Estimasi berdasarkan label ING yang terdeteksi AI —
                bukan klaim resmi Nutri-Level Kemenkes RI (KMK HK.01.07/MENKES/301/2026).
              </p>
            </section>
          );
        })()}

        {/* =======================================================
            RESULT POWDER STATE — Results for Powder Drinks
            ======================================================= */}
        {uiState === "result_powder" && result && (() => {
          const ls = LEVEL_CONFIG[result.level];
          return (
            <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
              <div className={S.resultHero} style={{ background: `linear-gradient(135deg, ${ls.bg}, ${ls.bg}88)` }} />

              <div className={S.levelHeroCard} style={{ background: ls.bg + '20' }}>
                <div className={S.levelHeroBg} style={{ background: ls.bg + '14' }} />
                <span className={S.sectionBadge} style={{ background: ls.bg + '20', color: ls.bg, position: 'relative', zIndex: 1 }}>
                  ✓ Estimasi Nutri-Level — Produk Serbuk
                </span>
                <div className={S.levelBigBadge} style={{ background: ls.bg }}>
                  {result.level}
                </div>
                <div className={S.levelName} style={{ color: 'var(--text-primary)' }}>{ls.label}</div>
                <div className={S.levelDesc} style={{ color: ls.bg }}>{ls.desc}</div>
                <NutriBar activeLevel={result.level} />
              </div>

              <div className={S.productInfoBar}>
                <span className={S.productEmoji}>☕</span>
                <div>
                  <div className={S.productName}>{result.namaProduk || "Produk Serbuk"}</div>
                  <div className={S.productMeta}>
                    {result.sajiG}g + {result.volumeAirMl}ml → <strong>{result.volumeTotal}ml</strong>
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: '10px 12px' }}>
                <span className={S.sectionLabel}>Detail per 100 ml minuman jadi</span>
                <ComponentRows components={result.components} />
              </div>

              {result.penentu && (
                <div className={S.penentuBox} style={{ background: ls.bg + '1A', border: `1px solid ${ls.bg}30` }}>
                  <i className="ti ti-info-circle" style={{ fontSize: 15, color: ls.bg, flexShrink: 0 }} aria-hidden="true" />
                  <span>
                    Ditentukan oleh <strong style={{ color: 'var(--text-primary)' }}>{result.penentu.name}</strong> — komponen dengan level tertinggi
                  </span>
                </div>
              )}

              <div style={{ height: 6 }} />
              <button className={S.btnOutline} onClick={reset}>
                <i className="ti ti-camera" style={{ fontSize: 15 }} aria-hidden="true" />
                Scan Produk Lain
              </button>
              <p className={S.disclaimer}>
                Estimasi berdasarkan label ING + volume air yang diinput.
                Hasil aktual bisa berbeda tergantung cara penyajian.
              </p>
            </section>
          );
        })()}

        {/* =======================================================
            RESULT RANGE STATE — Double Scenario Quick Range Output
            ======================================================= */}
        {uiState === "result_range" && result && (
          <section className={S.card} style={{ animation: "slideUp .4s ease-out" }}>
            <div className={S.sectionBadge} style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}>
              <i className="ti ti-bolt" style={{ fontSize: 12 }} aria-hidden="true" />
              Estimasi Rentang — Fase 3
            </div>

            <h2 className={S.cardTitle}>
              {result.namaProduk || "Produk Serbuk"}
            </h2>
            <p className={S.cardDesc}>
              Karena volume air tidak diketahui, sistem menampilkan <strong>dua skenario</strong>.
              Hasil aktual bergantung pada cara penyajian.
            </p>

            <div className={S.warningBox}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <span>
                <strong>Akurasi rendah</strong> — ini adalah estimasi kasar berdasarkan
                asumsi standar untuk kategori <em>{result.rangeLabel}</em>.
                Untuk hasil akurat, gunakan Jalur A atau B.
              </span>
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
              <i className="ti ti-info-circle" style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <span>
                <strong>Mengapa dua skenario?</strong> Menampilkan satu angka pasti
                untuk data yang tidak kita ketahui akan menciptakan <em>false precision</em> —
                kepercayaan diri semu yang bisa menyesatkan. Rentang ini lebih jujur
                tentang ketidakpastian yang ada.
              </span>
            </div>

            <div style={{ height: 14 }} />
            <button className={S.btnOutline}
              onClick={() => { setUiState("powder_interrupt"); setError(null); }}>
              ← Coba Jalur A atau B
            </button>
            <button className={S.btnGhost} onClick={reset} style={{ marginTop: 6 }}>
              <i className="ti ti-camera" style={{ fontSize: 13 }} aria-hidden="true" /> Scan Produk Lain
            </button>
            <p className={S.disclaimer}>
              Estimasi kasar — bukan klaim resmi Nutri-Level Kemenkes RI.
            </p>
          </section>
        )}

        {/* Reference Threshold Table (Idle only) */}
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
        ScanGizi · Estimasi berbasis AI · KMK HK.01.07/MENKES/301/2026
      </footer>

      {zoomImage && (
        <div className={S.lightboxOverlay} onClick={() => setZoomImage(null)}>
          <div className={S.lightboxContent} onClick={e => e.stopPropagation()}>
            <button className={S.lightboxClose} onClick={() => setZoomImage(null)} aria-label="Tutup gambar">
              <i className="ti ti-x" />
            </button>
            <img src={zoomImage} className={S.lightboxImg} alt="Tampilan diperbesar" />
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </div>
  );
}
