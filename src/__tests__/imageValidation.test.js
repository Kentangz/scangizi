import { describe, it, expect, vi } from "vitest";
import { validateImageFile, FileValidationError } from "../imageUtils.js";

class MockFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = buffer;
      if (this.onload) this.onload({ target: { result: buffer } });
    }).catch(err => {
      if (this.onerror) this.onerror(err);
    });
  }
}
global.FileReader = MockFileReader;

describe("Image Validation", () => {
  it("1. memverifikasi file JPEG valid lolos semua validasi", async () => {
    const buffer = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const file = new File([buffer], "test.jpg", { type: "image/jpeg" });
    
    await expect(validateImageFile(file)).resolves.toBeUndefined();
  });

  it("2. memverifikasi file PNG valid lolos validasi", async () => {
    const buffer = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const file = new File([buffer], "test.png", { type: "image/png" });
    
    await expect(validateImageFile(file)).resolves.toBeUndefined();
  });

  it("3. memverifikasi file dengan extension valid tapi magic bytes salah diblokir (SVG spoofing)", async () => {
    const buffer = new Uint8Array([0x3C, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6D, 0x6C, 0x6E, 0x73, 0x3D, 0x22]);
    const file = new File([buffer], "fake.jpg", { type: "image/jpeg" });
    
    try {
      await validateImageFile(file);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(FileValidationError);
      expect(err.code).toBe("INVALID_MAGIC_BYTES");
    }
  });

  it("4. memverifikasi file terlalu besar diblokir (>10MB)", async () => {
    const buffer = new Uint8Array([0xFF, 0xD8, 0xFF]);
    const file = new File([buffer], "large.jpg", { type: "image/jpeg" });
    
    Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });
    
    try {
      await validateImageFile(file);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(FileValidationError);
      expect(err.code).toBe("FILE_TOO_LARGE");
    }
  });

  it("5. memverifikasi MIME type tidak didukung diblokir", async () => {
    const buffer = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const file = new File([buffer], "test.gif", { type: "image/gif" });
    
    try {
      await validateImageFile(file);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(FileValidationError);
      expect(err.code).toBe("INVALID_FILE_TYPE");
    }
    
    const pdfFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "test.pdf", { type: "application/pdf" });
    try {
      await validateImageFile(pdfFile);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(FileValidationError);
      expect(err.code).toBe("INVALID_FILE_TYPE");
    }
  });
});
