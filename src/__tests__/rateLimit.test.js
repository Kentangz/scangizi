import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit, incrementRateLimit, resetRateLimit } from "../api.js";

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

describe("Rate Limiting", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. memverifikasi bahwa 15 request pertama berhasil tanpa error", () => {
    expect(() => {
      for (let i = 0; i < 15; i++) {
        checkRateLimit();
        incrementRateLimit();
      }
    }).not.toThrow();
    
    const state = JSON.parse(localStorage.getItem("scangizi_rl"));
    expect(state.count).toBe(15);
  });

  it("2. memverifikasi bahwa request ke-16 melempar RateLimitError", () => {
    // Fill the quota
    for (let i = 0; i < 15; i++) {
      checkRateLimit();
      incrementRateLimit();
    }

    // 16th request
    try {
      checkRateLimit();
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err.name).toBe("RateLimitError");
      expect(err.retryAfterMs).toBeGreaterThan(0);
      expect(err.retryAfterMs).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(err.message).toMatch(/Batas scan tercapai. Coba lagi dalam \d+ menit./);
    }
  });

  it("3. memverifikasi window expiry (reset setelah 60 menit)", () => {
    vi.useFakeTimers();
    const now = Date.now();
    
    // Set state ke 15 request, dimulai 61 menit yang lalu
    localStorage.setItem(
      "scangizi_rl",
      JSON.stringify({ count: 15, windowStart: now - 61 * 60 * 1000 })
    );

    // checkRateLimit harus mereset window karena sudah > 60 menit, bukan throw
    expect(() => checkRateLimit()).not.toThrow();
    
    const state = JSON.parse(localStorage.getItem("scangizi_rl"));
    expect(state.count).toBe(0);
  });

  it("4. memverifikasi robustness terhadap data corrupt (fail open)", () => {
    // String bukan JSON
    localStorage.setItem("scangizi_rl", "ini-bukan-json");
    expect(() => checkRateLimit()).not.toThrow();

    // JSON bukan object yang benar
    localStorage.setItem("scangizi_rl", JSON.stringify({ hacked: true }));
    expect(() => checkRateLimit()).not.toThrow();
    
    // Harus di-reset (dihapus) jika corrupt
    expect(localStorage.getItem("scangizi_rl")).toBeNull();
  });

  it("5. memverifikasi robustness terhadap localStorage unavailable", () => {
    // Mock getItem throw exception
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error("SecurityError: The operation is insecure.");
    });
    
    // Harus fail open, tidak throw ke luar
    expect(() => checkRateLimit()).not.toThrow();
  });
});
