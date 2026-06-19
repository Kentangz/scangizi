import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

// Setup mock hooks storage
let hooks = [];
let hookIdx = 0;

vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    useState: (initial) => {
      const idx = hookIdx++;
      if (hooks[idx] === undefined) {
        hooks[idx] = typeof initial === "function" ? initial() : initial;
      }
      const setter = (val) => {
        if (typeof val === "function") {
          hooks[idx] = val(hooks[idx]);
        } else {
          hooks[idx] = val;
        }
      };
      return [hooks[idx], setter];
    },
    useRef: (initial) => {
      const idx = hookIdx++;
      if (hooks[idx] === undefined) {
        hooks[idx] = { current: initial };
      }
      return hooks[idx];
    },
    useCallback: (fn) => {
      const idx = hookIdx++;
      hooks[idx] = fn; // Always store/update with the latest closure
      return fn;
    },
    useEffect: (fn) => {
      const idx = hookIdx++;
      hooks[idx] = fn;
      return fn;
    },
  };
});

// Import App after mocking React
import App from "../App.jsx";

function renderApp() {
  hookIdx = 0;
  return App();
}

describe("Manual Input and Edit Mode Flow Integration Tests", () => {
  beforeEach(() => {
    // Reset all hooks state
    hooks = [];
    hookIdx = 0;
  });

  it("1. Setting form inputs and submitting valid values correctly calculates the nutri-level", () => {
    renderApp();
    
    // Simulate transitioning to manual input from scratch
    const enterManualInput = hooks[30];
    expect(enterManualInput).toBeDefined();
    enterManualInput();

    // Verify state transition to manual_input
    expect(hooks[0]).toBe("manual_input");

    // Populate valid values for liquid product
    hooks[28] = {
      nama_produk: "Susu Kotak UHT",
      satuan_saji: "ml",
      ukuran_sajian_nilai: "200",
      total_gula_g: "10",
      laktosa_g: "2",
      natrium_mg: "80",
      lemak_jenuh_g: "1.0",
      volume_air_ml: "",
    };

    // Render again to apply states, then capture submitForm
    renderApp();
    const submitForm = hooks[33];
    expect(submitForm).toBeDefined();

    // Trigger form submission
    submitForm({ preventDefault: () => {} });

    // Assert states updated correctly
    expect(hooks[0]).toBe("result_liquid");
    expect(hooks[3]).toBeDefined();
    expect(hooks[3].level).toBe("B"); // Sugar net: (10-2)/200*100 = 4g/100ml -> B. Sodium: 80/200*100 = 40mg/100ml -> B. Fat: 1/200*100 = 0.5g/100ml -> A. Worst: B.
    expect(hooks[2].nama_produk).toBe("Susu Kotak UHT");
  });

  it("2. Inputting invalid values triggers validation errors mapping to validateAIResponse", () => {
    renderApp();
    const enterManualInput = hooks[30];
    enterManualInput();

    // Set invalid values: Sugar > 200g
    hooks[28] = {
      nama_produk: "Sirup Manis Sekali",
      satuan_saji: "ml",
      ukuran_sajian_nilai: "100",
      total_gula_g: "250", // Invalid: max 200
      laktosa_g: "",
      natrium_mg: "50",
      lemak_jenuh_g: "0",
      volume_air_ml: "",
    };

    renderApp();
    const submitForm = hooks[33];
    submitForm({ preventDefault: () => {} });

    // Should block submission and map error to total_gula_g
    expect(hooks[0]).toBe("manual_input");
    expect(hooks[29].total_gula_g).toBeDefined();
    expect(hooks[29].total_gula_g).toContain("out of plausible range");

    // Set invalid values: Sodium > 5000mg
    hooks[28] = {
      nama_produk: "Kecap Asin Ekstrem",
      satuan_saji: "ml",
      ukuran_sajian_nilai: "100",
      total_gula_g: "5",
      laktosa_g: "",
      natrium_mg: "6000", // Invalid: max 5000
      lemak_jenuh_g: "0",
      volume_air_ml: "",
    };

    renderApp();
    const submitForm2 = hooks[33];
    submitForm2({ preventDefault: () => {} });

    expect(hooks[0]).toBe("manual_input");
    expect(hooks[29].natrium_mg).toBeDefined();
    expect(hooks[29].natrium_mg).toContain("out of plausible range");
  });

  it("3. Transitioning to edit_mode correctly loads values from extracted, and canceling returns to original state", () => {
    // Set up an existing result and extracted data
    hooks[2] = {
      nama_produk: "Kopi Tubruk Instant",
      satuan_saji: "g",
      ukuran_sajian_nilai: 20,
      total_gula_g: 10,
      laktosa_g: null,
      natrium_mg: 40,
      lemak_jenuh_g: 1,
      volume_air_ml: 150,
    };
    hooks[0] = "result_powder";

    renderApp();

    const enterEditMode = hooks[31];
    expect(enterEditMode).toBeDefined();

    // Transition to edit mode from result_powder
    enterEditMode("result_powder");

    // Check uiState is edit_mode
    expect(hooks[0]).toBe("edit_mode");
    // Check preEditState is result_powder
    expect(hooks[27]).toBe("result_powder");

    // Check form values loaded as strings
    expect(hooks[28].nama_produk).toBe("Kopi Tubruk Instant");
    expect(hooks[28].total_gula_g).toBe("10");
    expect(hooks[28].ukuran_sajian_nilai).toBe("20");
    expect(hooks[28].volume_air_ml).toBe("150");

    // Click cancel
    renderApp();
    const cancelEdit = hooks[32];
    cancelEdit();

    // Returns to original state
    expect(hooks[0]).toBe("result_powder");
  });

  it("4. Persistence of imgData state during form transitions", () => {
    // Set initial image data
    const dummyImg = { dataUrl: "data:image/png;base64,abcdef", base64: "abcdef" };
    hooks[1] = dummyImg;
    hooks[0] = "idle";

    renderApp();

    // Transition to manual_input
    const enterManualInput = hooks[30];
    enterManualInput();
    expect(hooks[1]).toBe(dummyImg); // preserved

    // Transition to edit_mode
    const enterEditMode = hooks[31];
    enterEditMode("result_liquid");
    expect(hooks[1]).toBe(dummyImg); // preserved

    // Form submit
    hooks[28] = {
      nama_produk: "Susu Kotak UHT",
      satuan_saji: "ml",
      ukuran_sajian_nilai: "200",
      total_gula_g: "10",
      laktosa_g: "2",
      natrium_mg: "80",
      lemak_jenuh_g: "1.0",
      volume_air_ml: "",
    };
    renderApp();
    const submitForm = hooks[33];
    submitForm({ preventDefault: () => {} });
    expect(hooks[1]).toBe(dummyImg); // preserved

    // Trigger reset
    renderApp();
    const reset = hooks[25];
    reset();
    expect(hooks[1]).toBeNull(); // cleared on reset
  });
});
