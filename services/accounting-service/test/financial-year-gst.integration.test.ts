import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
const context = vi.hoisted(() => ({ tenantId: "" }));
vi.mock("@fii/auth", () => ({
  authenticate: (req: { auth?: unknown }, _res: unknown, next: () => void) => { req.auth = { tenantId: context.tenantId }; next(); },
  authorize: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import { prisma, computeBalanceSheet } from "@fii/database";
import { collectSectionCounts } from "../src/gstr1-files.js";
import { gstRouter } from "../src/gst.js";
import { generate } from "../../../workers/report-worker/src/generators.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("financial year profit and offline GST counts", () => {
  let tenantId = "", customerId = "";
  let server: Server, baseUrl = "";
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
    context.tenantId = tenantId;
    const app = express(); app.use(gstRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await prisma.creditNote.deleteMany({ where: { tenantId } }); await prisma.debitNote.deleteMany({ where: { tenantId } });
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
  it("excludes without-GST invoices and their notes across summaries and exports, but retains zero-rated GST invoices and financial totals", async () => {
    const base = { tenantId, customerId, fyCode: "2026-27", invoiceDate: new Date("2026-10-10"), dueDate: new Date("2026-10-20"), placeOfSupply: "33" };
    const nonGst = await prisma.invoice.create({ data: { ...base, invoiceNumber: "NG-EXCLUDED", chargeGst: false, subTotal: 1500, taxableValue: 1500, grandTotal: 1500,
      items: { create: { description: "Non-GST", hsnSac: "NGTEST", quantity: 1, unitPrice: 1500, taxableValue: 1500, gstRate: 0, lineTotal: 1500 } } } });
    await prisma.invoice.create({ data: { ...base, invoiceNumber: "GST-ZERO-KEPT", chargeGst: true, subTotal: 50, taxableValue: 50, grandTotal: 50,
      items: { create: { description: "Zero-rated GST", hsnSac: "ZERO", quantity: 1, unitPrice: 50, taxableValue: 50, gstRate: 0, lineTotal: 50 } } } });
    await prisma.creditNote.create({ data: { tenantId, customerId, invoiceId: nonGst.id, fyCode: base.fyCode, noteNumber: "NG-CREDIT", noteDate: base.invoiceDate, reason: "Test", items: [], taxableValue: 100, total: 100 } });
    await prisma.debitNote.create({ data: { tenantId, customerId, invoiceId: nonGst.id, fyCode: base.fyCode, noteNumber: "NG-DEBIT", noteDate: base.invoiceDate, reason: "Test", items: [], taxableValue: 20, total: 20 } });
    const counts = await collectSectionCounts(tenantId, 2026, 10);
    expect(counts.b2b).toEqual({ rows: 3, documents: 2 });
    expect(counts.docs).toEqual({ rows: 1, documents: 3 });
    expect(counts.cdnr.rows).toBe(0);
    const gstr1 = await (await fetch(`${baseUrl}/gstr1?from=2026-10-01&to=2026-10-31`)).json();
    expect(gstr1.summary.taxableValue).toBe(150);
    expect(gstr1.docs.invoices.count).toBe(2);
    expect(gstr1.hsn.some((row: { hsnSac: string }) => row.hsnSac === "NGTEST")).toBe(false);
    expect(gstr1.cdnr.credit).toHaveLength(0); expect(gstr1.cdnr.debit).toHaveLength(0);
    const gstr3b = await (await fetch(`${baseUrl}/gstr3b?year=2026&month=10`)).json();
    expect(gstr3b.outward.taxableValue).toBe(150);
    const exported = await generate("GSTR1", tenantId, { from: "2026-10-01", to: "2026-10-31" });
    expect(exported.rows.map((row) => row[0])).not.toContain("NG-EXCLUDED");
    expect(exported.rows.map((row) => row[0])).toContain("GST-ZERO-KEPT");
    expect((await generate("GSTR3B", tenantId, { year: 2026, month: 10 })).rows[0]).toEqual(["Outward tax", 5.75, 5.75, 0]);
    expect((await computeBalanceSheet(tenantId, new Date("2026-10-27"))).detail.profitAndLoss).toBe(1570);
    expect(await prisma.invoice.count({ where: { id: nonGst.id, chargeGst: false } })).toBe(1);
  });
});
