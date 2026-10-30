import { describe, expect, it } from "vitest";
import { paymentCreateBody } from "../src/services/payment.service.js";
const invoiceId = "11111111-1111-4111-8111-111111111111";
const base = { customerId: invoiceId, amount: 98, tdsAmount: 2, mode: "CASH", paymentDate: "2026-10-31", allocations: [{ invoiceId, amount: 98, tdsAmount: 2 }] };
describe("TDS payment validation", () => {
  it("keeps cash-only clients compatible with zero TDS defaults", () => { expect(paymentCreateBody.parse({ ...base, tdsAmount: undefined, allocations: [{ invoiceId, amount: 98 }] }).tdsAmount).toBe(0); });
  it("requires all TDS to be allocated and prevents negative, duplicate or sub-paisa entries", () => {
    for (const value of [ { ...base, allocations: [] }, { ...base, tdsAmount: -2 }, { ...base, amount: 1.001 }, { ...base, allocations: [...base.allocations, ...base.allocations] }, { ...base, amount: 0, tdsAmount: 0, allocations: [] } ]) expect(paymentCreateBody.safeParse(value).success).toBe(false);
  });
  it("validates reference for actual bank receipts but allows TDS-only adjustment", () => {
    expect(paymentCreateBody.safeParse({ ...base, mode: "BANK_TRANSFER" }).success).toBe(false);
    expect(paymentCreateBody.safeParse({ ...base, mode: "BANK_TRANSFER", amount: 0, allocations: [{ invoiceId, amount: 0, tdsAmount: 2 }] }).success).toBe(true);
  });
});
