import { describe, it, expect } from "vitest";
import { computeGst } from "../src/gst.js";

describe("computeGst", () => {
  it("splits CGST + SGST for intra-state supply", () => {
    const t = computeGst([{ quantity: 1, unitPrice: 1000, gstRate: 18 }], false);
    expect(t.taxableValue).toBe("1000.00");
    expect(t.cgst).toBe("90.00");
    expect(t.sgst).toBe("90.00");
    expect(t.igst).toBe("0.00");
    expect(t.grandTotal).toBe("1180.00");
  });

  it("charges IGST for inter-state supply", () => {
    const t = computeGst([{ quantity: 1, unitPrice: 1000, gstRate: 18 }], true);
    expect(t.igst).toBe("180.00");
    expect(t.cgst).toBe("0.00");
    expect(t.sgst).toBe("0.00");
    expect(t.grandTotal).toBe("1180.00");
  });

  it("applies the line discount before tax", () => {
    const t = computeGst([{ quantity: 2, unitPrice: 500, discount: 100, gstRate: 18 }], false);
    expect(t.discountTotal).toBe("100.00");
    expect(t.taxableValue).toBe("900.00");
    expect(t.grandTotal).toBe("1062.00");
  });

  it("absorbs paise into roundOff so grand total is whole rupees", () => {
    const t = computeGst([{ quantity: 1, unitPrice: 999, gstRate: 5 }], false);
    // 999 + 49.95 = 1048.95 → rounds to 1049.00
    expect(t.grandTotal).toBe("1049.00");
    expect(Number(t.grandTotal) % 1).toBe(0);
    expect(Math.abs(Number(t.roundOff))).toBeLessThanOrEqual(0.5);
  });

  it("rejects a discount larger than the line amount", () => {
    expect(() => computeGst([{ quantity: 1, unitPrice: 100, discount: 200, gstRate: 18 }], false)).toThrow();
  });

  it("sums multiple lines", () => {
    const t = computeGst([
      { quantity: 1, unitPrice: 1000, gstRate: 18 },
      { quantity: 2, unitPrice: 250, gstRate: 12 },
    ], false);
    expect(t.taxableValue).toBe("1500.00");
    expect(t.cgst).toBe("120.00"); // 90 + 30
    expect(t.sgst).toBe("120.00");
  });
});
