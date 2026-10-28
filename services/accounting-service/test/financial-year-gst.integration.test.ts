import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma, computeBalanceSheet } from "@fii/database";
import { collectSectionCounts } from "../src/gstr1-files.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("financial year profit and offline GST counts", () => {
  let tenantId = "", customerId = "";
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Report FY test", subdomain: `report-fy-${Date.now()}`, stateCode: "33" } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "C1", name: "Registered customer", gstin: "33AAACT2664C1ZS", gstTreatment: "B2B" } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31T23:59:59Z"), isActive: true } });
    const base = { tenantId, customerId, invoiceType: "MANUAL" as const, placeOfSupply: "33", gstTreatment: "B2B" as const, dueDate: new Date("2026-11-01"), status: "UNPAID" as const };
    await prisma.invoice.create({ data: { ...base, invoiceNumber: "OLD", fyCode: "2025-26", invoiceDate: new Date("2025-10-01"), subTotal: 200, taxableValue: 200, cgst: 18, sgst: 18, grandTotal: 236 } });
    await prisma.invoice.create({ data: { ...base, invoiceNumber: "NEW", fyCode: "2026-27", invoiceDate: new Date("2026-10-01"), subTotal: 100, taxableValue: 100, cgst: 5.75, sgst: 5.75, grandTotal: 111.5,
      items: { create: [5,18].map((gstRate) => ({ description: "Service", hsnSac: "998599", quantity: 1, unitPrice: 50, gstRate, taxableValue: 50, cgst: gstRate / 4, sgst: gstRate / 4, lineTotal: 50 + gstRate / 2 })) } } });
    await prisma.invoice.create({ data: { ...base, invoiceNumber: "CANCELLED", fyCode: "2026-27", invoiceDate: new Date("2026-10-02"), status: "CANCELLED", subTotal: 100, taxableValue: 100, grandTotal: 118 } });
    await prisma.ledgerEntry.create({ data: { tenantId, partyType: "CUSTOMER", partyId: customerId, fyCode: "2025-26", entryDate: new Date("2025-10-01"), entryType: "INVOICE", debit: 347.5 } });
  });
  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { tenantId } }); await prisma.invoiceItem.deleteMany({ where: { invoice: { tenantId } } });
    await prisma.invoice.deleteMany({ where: { tenantId } }); await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.financialYear.deleteMany({ where: { tenantId } }); await prisma.tenant.delete({ where: { id: tenantId } }); await prisma.$disconnect();
  });
  it("shows current FY profit separately while retaining opening assets and prior earnings", async () => {
    const bs = await computeBalanceSheet(tenantId, new Date("2026-10-27"));
    expect(bs.detail.profitAndLoss).toBe(100); expect(bs.detail.sundryDebtors).toBe(347.5);
    expect(bs.liabilities.lines.find((line) => line.particulars === "Retained earnings (prior years)")?.amount).toBe(200);
  });
  it("counts GST export rows separately from distinct documents and includes cancelled documents only in docs", async () => {
    const counts = await collectSectionCounts(tenantId, 2026, 10);
    expect(counts.b2b).toEqual({ rows: 2, documents: 1 }); expect(counts.docs).toEqual({ rows: 1, documents: 2 });
    expect(counts.b2ba).toEqual({ rows: 0, documents: null }); expect(counts["hsn-b2b"].rows).toBe(2);
    expect((await collectSectionCounts(tenantId, 2026, 9)).b2b.rows).toBe(0);
  });
});
