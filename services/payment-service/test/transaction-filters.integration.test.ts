import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { listPayments, paymentListQuery } from "../src/services/payment.service.js";
import { listPurchaseInvoices, listPurchaseReturns, pagination } from "../../purchase-service/src/services/purchase.service.js";
import { listPos, poListQuery } from "../../purchase-service/src/services/po.service.js";
import { listNotes } from "../../billing-service/src/services/note.service.js";
import { noteListQuery } from "../../billing-service/src/validators.js";

const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("transaction FY, status and inclusive date filters", () => {
  let tenantId = "", customerId = "", supplierId = "", invoiceId = "";
  const current = { fyCode: "2026-27", date: new Date("2026-10-27T20:00:00Z") };
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Transaction filters", subdomain: `transaction-filters-${Date.now()}` } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, name: "Customer", code: "C" } })).id;
    supplierId = (await prisma.supplier.create({ data: { tenantId, name: "Supplier", code: "S" } })).id;
    invoiceId = (await prisma.invoice.create({ data: { tenantId, customerId, invoiceNumber: "BASE", fyCode: current.fyCode, invoiceDate: current.date, dueDate: current.date, placeOfSupply: "33", subTotal: "100", taxableValue: "100", grandTotal: "100" } })).id;
    for (const [index, period] of [current, { fyCode: "2025-26", date: new Date("2025-10-27") }, { fyCode: "2026-27", date: new Date("2026-10-28") }].entries()) {
      await prisma.payment.create({ data: { tenantId, customerId, fyCode: period.fyCode, amount: "10", mode: "CASH", status: "SUCCESS", paymentDate: period.date } });
      const purchase = await prisma.purchaseInvoice.create({ data: { tenantId, supplierId, fyCode: period.fyCode, invoiceDate: period.date, billNumber: `B-${index}`, ourNumber: `P-${index}`, subTotal: "100", taxableValue: "100", grandTotal: "100", amountPaid: "40", status: "PARTIAL" } });
      await prisma.purchaseOrder.create({ data: { tenantId, supplierId, fyCode: period.fyCode, orderDate: period.date, poNumber: `PO-${index}`, total: "100", status: "SENT" } });
      await prisma.purchaseReturn.create({ data: { tenantId, supplierId, fyCode: period.fyCode, returnDate: period.date, returnNumber: `R-${index}`, purchaseInvoiceId: purchase.id, items: [], taxableValue: "10", totalGst: "0", total: "10" } });
      await prisma.creditNote.create({ data: { tenantId, customerId, invoiceId, fyCode: period.fyCode, noteDate: period.date, noteNumber: `CN-${index}`, reason: "test", items: [], taxableValue: "10", total: "10", status: "ISSUED" } });
    }
  });
  afterAll(async () => {
    const where = { tenantId };
    await prisma.creditNote.deleteMany({ where });
    await prisma.payment.deleteMany({ where });
    await prisma.purchaseReturn.deleteMany({ where });
    await prisma.purchaseOrder.deleteMany({ where });
    await prisma.purchaseInvoice.deleteMany({ where });
    await prisma.invoice.deleteMany({ where });
    await prisma.customer.deleteMany({ where });
    await prisma.supplier.deleteMany({ where });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });
  const period = { fyCode: "2026-27", from: "2026-04-01", to: "2026-10-27" };
  it("filters receipts by their own year, full payment date and status", async () => {
    expect((await listPayments(tenantId, paymentListQuery.parse({ ...period, status: "SUCCESS" }))).total).toBe(1);
    expect((await listPayments(tenantId, paymentListQuery.parse({ ...period, status: "FAILED" }))).total).toBe(0);
    expect((await listPayments(tenantId, paymentListQuery.parse({}))).total).toBe(3);
  });
  it("filters unpaid/partial purchase invoices without changing unfiltered callers", async () => {
    expect((await listPurchaseInvoices(tenantId, pagination.parse({ ...period, status: "OUTSTANDING" }))).total).toBe(1);
    expect((await listPurchaseInvoices(tenantId, pagination.parse({ ...period, status: "PAID" }))).total).toBe(0);
    expect((await listPurchaseInvoices(tenantId, pagination.parse({}))).total).toBe(3);
  });
  it("uses order, return and note dates for the other transaction lists", async () => {
    expect((await listPos(tenantId, poListQuery.parse({ ...period, status: "SENT" }))).total).toBe(1);
    expect((await listPos(tenantId, poListQuery.parse({ ...period, status: "CANCELLED" }))).total).toBe(0);
    expect((await listPurchaseReturns(tenantId, pagination.parse(period))).total).toBe(1);
    expect((await listNotes(tenantId, "credit", noteListQuery.parse({ ...period, status: "ISSUED" }))).total).toBe(1);
    expect((await listNotes(tenantId, "credit", noteListQuery.parse({ ...period, status: "CANCELLED" }))).total).toBe(0);
  });
});
