import { describe, expect, it, vi } from "vitest";
import { autoAllocations } from "../src/services/settle.js";

describe("payment auto-allocation", () => {
  it("allocates oldest invoices first and accounts for credits", async () => {
    const tx = { invoice: { findMany: vi.fn().mockResolvedValue([
      { id: "old", grandTotal: 100, amountPaid: 20, creditedAmount: 10 },
      { id: "new", grandTotal: 80, amountPaid: 0, creditedAmount: 0 },
    ]) } };
    await expect(autoAllocations(tx as never, "tenant-a", "customer-a", 100)).resolves.toEqual([
      { invoiceId: "old", amount: 70 },
      { invoiceId: "new", amount: 30 },
    ]);
  });

  it("never allocates more than the available balance", async () => {
    const tx = { invoice: { findMany: vi.fn().mockResolvedValue([
      { id: "one", grandTotal: 50, amountPaid: 40, creditedAmount: 5 },
    ]) } };
    await expect(autoAllocations(tx as never, "tenant-a", "customer-a", 999)).resolves.toEqual([
      { invoiceId: "one", amount: 5 },
    ]);
  });
});
