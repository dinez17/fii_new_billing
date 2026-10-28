import { describe, expect, it } from "vitest";
import { decodeDocument, maskId } from "../src/services/customer-kyc.service.js";

describe("customer document validation", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ4QAAAAASUVORK5CYII=";
  it("accepts supported image bytes and returns the decoded size", () => {
    expect(decodeDocument("PHOTO", png).mimeType).toBe("image/png");
    expect(decodeDocument("PHOTO", png).bytes.length).toBeGreaterThan(0);
  });
  it("rejects PDFs as a customer photo while allowing them as proof", () => {
    const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nfixture").toString("base64")}`;
    expect(() => decodeDocument("PHOTO", pdf)).toThrow("photo must be");
    expect(decodeDocument("ID_FRONT", pdf).mimeType).toBe("application/pdf");
  });
  it("rejects spoofed formats and executable image types", () => {
    expect(() => decodeDocument("ID_FRONT", "data:application/pdf;base64,SGVsbG8=")).toThrow("contents do not match");
    expect(() => decodeDocument("PHOTO", "data:image/svg+xml;base64,PHN2Zz4=")).toThrow("PNG, JPEG or PDF");
  });
  it("rejects oversized photos and document payloads", () => {
    expect(() => decodeDocument("PHOTO", `data:image/png;base64,${Buffer.alloc(500 * 1024 + 1).toString("base64")}`)).toThrow("500 KB");
    expect(() => decodeDocument("ID_FRONT", `data:application/pdf;base64,${Buffer.alloc(1024 * 1024 + 1).toString("base64")}`)).toThrow("1 MB");
  });
  it("masks identity numbers to the last four characters", () => {
    expect(maskId("TEST-PRIVATE-1234")).toBe("****1234");
    expect(maskId("")).toBe("");
  });
});
