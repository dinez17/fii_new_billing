import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, rankParties, postCustomerPayment, computeBalanceSheet } from "@fii/database";
import { createPayment, paymentCreateBody, tdsReport } from "../src/services/payment.service.js";
import { buildReceiptPdfBuffer } from "@fii/pdf";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("customer TDS settlement and financial-year report", () => {
  let tenantId = "", otherId = "", customerId = "";
  let sequence = 0;
  const date = new Date("2026-10-31T00:00:00Z");
  async function invoice(total = 11800, customer = customerId, tenant = tenantId) {
    return prisma.invoice.create({ data: { tenantId: tenant, customerId: customer, invoiceNumber: `TDS-${++sequence}`, fyCode: "2026-27", invoiceDate: date, dueDate: date, placeOfSupply: "33", subTotal: total, taxableValue: total, grandTotal: total } });
  }
  beforeAll(async () => {
    const stamp = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: "TDS test", subdomain: `tds-${stamp}` } })).id;
    otherId = (await prisma.tenant.create({ data: { name: "Other TDS", subdomain: `tds-other-${stamp}` } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "C-TDS", name: "TDS customer", phone: "9000000000", gstin: "33AAAAA0000A1Z5", openingBalance: 100 } })).id;
    await prisma.financialYear.createMany({ data: [
      { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31T23:59:59.999Z"), isActive: true },
      { tenantId, code: "2025-26", startDate: new Date("2025-04-01"), endDate: new Date("2026-03-31T23:59:59.999Z"), isActive: false, isLocked: true },
    ] });
    await prisma.numberSeries.create({ data: { tenantId, docType: "RECEIPT", fyCode: "2026-27", prefix: "TDS-R/", padding: 4 } });
  });
  afterAll(async () => {
    const where = { tenantId: { in: [tenantId, otherId] } };
    await prisma.auditLog.deleteMany({ where }); await prisma.outboxEvent.deleteMany({ where });
    await prisma.dayBookEntry.deleteMany({ where }); await prisma.ledgerEntry.deleteMany({ where });
    await prisma.receipt.deleteMany({ where }); await prisma.paymentAllocation.deleteMany({ where: { payment: where } });
    await prisma.payment.deleteMany({ where }); await prisma.invoice.deleteMany({ where });
    await prisma.numberSeries.deleteMany({ where }); await prisma.financialYear.deleteMany({ where });
    await prisma.customer.deleteMany({ where }); await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } }); await prisma.$disconnect();
  });
  it("settles cash plus TDS while keeping collections and daybook cash-only", async () => {
    const inv = await invoice();
    const payment = await createPayment(tenantId, null, paymentCreateBody.parse({ customerId, amount: 11600, tdsAmount: 200, tdsSection: "Customer deduction", mode: "BANK_TRANSFER", reference: "UTR-TDS", paymentDate: date, allocations: [{ invoiceId: inv.id, amount: 11600, tdsAmount: 200 }] }));
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(saved.status).toBe("PAID"); expect(Number(saved.amountPaid)).toBe(11800);
    expect(Number(payment.amount)).toBe(11600); expect(Number(payment.tdsAmount)).toBe(200);
    const ranked = await rankParties(tenantId, "CUSTOMER", { page: 1, limit: 100, activity: "all", balance: "all", sortBy: "outstanding", order: "desc" });
    expect(Number(ranked.items[0]!.outstanding)).toBe(100);
    const events = await prisma.outboxEvent.findMany({ where: { tenantId, topic: "payment.success" } });
    expect(JSON.stringify(events)).toContain('"tdsAmount":"200.00"');
    await prisma.$transaction(tx => postCustomerPayment(tx, { tenantId, customerId, paymentId: payment.id, fyCode: "2026-27", entryDate: date, amount: "11600", tdsAmount: "200", mode: "BANK_TRANSFER", receiptNumber: payment.receipt.receiptNumber }));
    expect(Number((await prisma.ledgerEntry.findFirstOrThrow({ where: { tenantId, refId: payment.id } })).credit)).toBe(11800);
    expect(Number((await prisma.dayBookEntry.findFirstOrThrow({ where: { tenantId, refId: payment.id } })).amount)).toBe(11600);
    const sheet = await computeBalanceSheet(tenantId, date); expect(sheet.detail.tdsReceivable).toBe(200);
    const pdf = await buildReceiptPdfBuffer(tenantId, payment.receipt.id); expect(pdf.buffer.subarray(0,5).toString()).toBe("%PDF-");
    if (process.env.TDS_PDF_QA_PATH) writeFileSync(process.env.TDS_PDF_QA_PATH, pdf.buffer);
  });
  it("supports a TDS-only entry without creating a cash movement", async () => {
    const inv = await invoice(50);
    const payment = await createPayment(tenantId, null, paymentCreateBody.parse({ customerId, amount: 0, tdsAmount: 50, mode: "BANK_TRANSFER", paymentDate: date, allocations: [{ invoiceId: inv.id, amount: 0, tdsAmount: 50 }] }));
    await prisma.$transaction(tx => postCustomerPayment(tx, { tenantId, customerId, paymentId: payment.id, fyCode: "2026-27", entryDate: date, amount: "0", tdsAmount: "50", mode: "BANK_TRANSFER", receiptNumber: payment.receipt.receiptNumber }));
    expect(await prisma.dayBookEntry.count({ where: { tenantId, refId: payment.id } })).toBe(0);
    expect(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid)).toBe(50);
  });
  it("reports the full chosen FY and customer details, excluding failed/refunded and other tenants", async () => {
    await prisma.payment.createMany({ data: [
      { tenantId, customerId, fyCode: "2025-26", amount: 100, tdsAmount: 10, mode: "CASH", paymentDate: new Date("2025-08-01") },
      { tenantId, customerId, fyCode: "2026-27", amount: 100, tdsAmount: 800, mode: "CASH", status: "FAILED", paymentDate: date },
      { tenantId, customerId, fyCode: "2026-27", amount: 100, tdsAmount: 900, mode: "CASH", status: "REFUNDED", paymentDate: date },
    ] });
    const other = await prisma.customer.create({ data: { tenantId: otherId, code: "OTHER", name: "Other tenant" } });
    await prisma.payment.create({ data: { tenantId: otherId, customerId: other.id, fyCode: "2026-27", amount: 100, tdsAmount: 999, mode: "CASH", paymentDate: date } });
    const report = await tdsReport(tenantId, {});
    expect(report.totalTds).toBe("250.00"); expect(report.entries).toBe(2);
    expect(report.items[0]!.customer).toMatchObject({ name: "TDS customer", code: "C-TDS", phone: "9000000000" });
    expect((await tdsReport(tenantId, { fyCode: "2025-26" })).totalTds).toBe("10.00");
    expect((await tdsReport(tenantId, { customerId: other.id })).totalTds).toBe("0.00");
    await expect(tdsReport(tenantId, { fyCode: "1999-00" })).rejects.toThrow(/financial year/);
  });
  it("rejects over-settlement, foreign invoices and locked FY without partial writes", async () => {
    const inv = await invoice(100);
    const input = { customerId, amount: 99, tdsAmount: 2, mode: "CASH", paymentDate: date, allocations: [{ invoiceId: inv.id, amount: 99, tdsAmount: 2 }] };
    const before = await prisma.payment.count({ where: { tenantId } });
    await expect(createPayment(tenantId, null, paymentCreateBody.parse(input))).rejects.toThrow(/exceeds balance/);
    await expect(createPayment(otherId, null, paymentCreateBody.parse(input))).rejects.toThrow(/Customer/);
    const foreignCustomer = await prisma.customer.findFirstOrThrow({ where: { tenantId: otherId } });
    const foreignInvoice = await invoice(100, foreignCustomer.id, otherId);
    await expect(createPayment(tenantId, null, paymentCreateBody.parse({ ...input, amount: 98, allocations: [{ invoiceId: foreignInvoice.id, amount: 98, tdsAmount: 2 }] }))).rejects.toThrow(/Invoice/);
    await prisma.financialYear.updateMany({ where: { tenantId, isActive: true }, data: { isLocked: true } });
    await expect(createPayment(tenantId, null, paymentCreateBody.parse({ ...input, amount: 98, allocations: [{ invoiceId: inv.id, amount: 98, tdsAmount: 2 }] }))).rejects.toThrow(/locked/);
    await prisma.financialYear.updateMany({ where: { tenantId, isActive: true }, data: { isLocked: false } });
    expect(await prisma.payment.count({ where: { tenantId } })).toBe(before);
    expect(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid)).toBe(0);
  });
  it("locks invoices so concurrent TDS entries cannot over-settle", async () => {
    const inv = await invoice(25);
    const input = paymentCreateBody.parse({ customerId, amount: 0, tdsAmount: 25, mode: "CASH", paymentDate: date, allocations: [{ invoiceId: inv.id, amount: 0, tdsAmount: 25 }] });
    const results = await Promise.allSettled([createPayment(tenantId, null, input), createPayment(tenantId, null, input)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid)).toBe(25);
  });
});
