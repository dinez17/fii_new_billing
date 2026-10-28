import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { settleWithinTx } from "../src/services/settle.js";

const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

d("payment settlement (integration)", () => {
  const stamp = Date.now();
  let tenantId = "", customerId = "", invoiceId = "", paymentId = "";

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `SETTLE-${stamp}`, subdomain: `settle-${stamp}` } });
    tenantId = tenant.id;
    const customer = await prisma.customer.create({ data: { tenantId, code: "C-1", name: "Settlement Test", phone: String(stamp).slice(-10).padStart(10, "9") } });
    customerId = customer.id;
    await prisma.numberSeries.create({ data: { tenantId, docType: "RECEIPT", fyCode: "2026-27", prefix: "RCT/", nextNumber: 1, padding: 4 } });
    const invoice = await prisma.invoice.create({ data: {
      tenantId, invoiceNumber: "INV-1", invoiceType: "MANUAL", fyCode: "2026-27", customerId,
      invoiceDate: new Date("2026-06-01"), dueDate: new Date("2026-06-10"), placeOfSupply: "32",
      subTotal: 100, taxableValue: 100, grandTotal: 118, cgst: 9, sgst: 9,
    } });
    invoiceId = invoice.id;
    const payment = await prisma.payment.create({ data: { tenantId, customerId, fyCode: "2026-27", amount: 118, mode: "CASH", status: "SUCCESS" } });
    paymentId = payment.id;
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { tenantId } });
    await prisma.receipt.deleteMany({ where: { tenantId } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentId } });
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.invoice.deleteMany({ where: { tenantId } });
    await prisma.numberSeries.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("atomically allocates payment, closes invoice, creates receipt and outbox events", async () => {
    const receipt = await prisma.$transaction((tx) => settleWithinTx(tx, {
      tenantId, paymentId, customerId, amount: 118, mode: "CASH", paymentDate: new Date("2026-06-02"),
      fyCode: "2026-27", allocations: [{ invoiceId, amount: 118 }],
    }));
    expect(receipt.receiptNumber).toBe("RCT/0001");
    await expect(prisma.invoice.findUnique({ where: { id: invoiceId } })).resolves.toMatchObject({ status: "PAID" });
    expect(await prisma.paymentAllocation.count({ where: { paymentId, invoiceId } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { tenantId } })).toBe(2);
  });
});
