import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import type { EventEnvelope } from "@fii/kafka";
import { createInvoice, updateInvoice } from "../src/services/invoice.service.js";
import { postInvoiceEdit, type InvoiceEdit } from "../../../workers/ledger-worker/src/invoice-edit.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("full invoice editing", () => {
  let tenantId = "", customerId = "", otherCustomerId = "", actorId = "", productId = "";
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Invoice edit test", subdomain: `edit-${Date.now()}`, stateCode: "33" } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "C1", name: "Original customer", stateCode: "33" } })).id;
    otherCustomerId = (await prisma.customer.create({ data: { tenantId, code: "C2", name: "Interstate customer", stateCode: "29" } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, email: "edit@example.test", name: "Tester", passwordHash: "not-a-login" } })).id;
    productId = (await prisma.product.create({ data: { tenantId, sku: "GOODS", name: "Goods", salePrice: 100, stockQty: 10 } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isActive: true } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } }); await prisma.outboxEvent.deleteMany({ where: { tenantId } });
    await prisma.ledgerEntry.deleteMany({ where: { tenantId } }); await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { tenantId } } }); await prisma.invoice.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } }); await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } }); await prisma.numberSeries.deleteMany({ where: { tenantId } });
    await prisma.financialYear.deleteMany({ where: { tenantId } }); await prisma.tenant.delete({ where: { id: tenantId } }); await prisma.$disconnect();
  });
  it("recalculates items/GST, changes customer and dates, adjusts stock and posts idempotent ledger corrections", async () => {
    const line = { productId, description: "Goods", quantity: 2, unitPrice: 100, discount: 0, gstRate: 18 };
    const invoice = await createInvoice(tenantId, actorId, { customerId, invoiceDate: new Date("2026-10-20"), dueDate: new Date("2026-11-01"), items: [line] });
    await prisma.ledgerEntry.create({ data: { tenantId, partyType: "CUSTOMER", partyId: customerId, fyCode: "2026-27", entryDate: invoice.invoiceDate, entryType: "INVOICE", refId: invoice.id, debit: invoice.grandTotal } });
    const updated = await updateInvoice(tenantId, actorId, invoice.id, { customerId: otherCustomerId, invoiceDate: new Date("2026-10-21"), dueDate: new Date("2026-11-05"), poNumber: "NEW-PO", terms: "Revised terms", notes: "Revised", items: [{ ...line, quantity: 3, unitPrice: 200 }] });
    expect(updated.invoiceNumber).toBe(invoice.invoiceNumber); expect(updated.grandTotal.toFixed(2)).toBe("708.00");
    expect(updated.igst.toFixed(2)).toBe("108.00"); expect(updated.cgst.toFixed(2)).toBe("0.00");
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty)).toBe(7);
    const event = (await prisma.outboxEvent.findFirstOrThrow({ where: { tenantId, topic: "invoice.updated" } })).payload as unknown as EventEnvelope<InvoiceEdit>;
    await postInvoiceEdit(event); await postInvoiceEdit(event);
    const old = await prisma.ledgerEntry.aggregate({ where: { tenantId, partyId: customerId }, _sum: { debit: true, credit: true } });
    expect(Number(old._sum.debit) - Number(old._sum.credit)).toBe(0);
    const fresh = await prisma.ledgerEntry.aggregate({ where: { tenantId, partyId: otherCustomerId }, _sum: { debit: true, credit: true } });
    expect(Number(fresh._sum.debit) - Number(fresh._sum.credit)).toBe(708);
    expect(await prisma.ledgerEntry.count({ where: { tenantId } })).toBe(3);
    await expect(updateInvoice(tenantId, actorId, invoice.id, { items: [{ ...line, quantity: 100 }] })).rejects.toThrow("Insufficient stock");
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty)).toBe(7);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).grandTotal.toFixed(2)).toBe("708.00");
    await expect(updateInvoice(tenantId, actorId, invoice.id, { dueDate: new Date("2026-10-01") })).rejects.toThrow("Due date");
    await expect(updateInvoice("another-tenant", actorId, invoice.id, { notes: "No" })).rejects.toThrow("Invoice not found");
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PARTIAL", amountPaid: 1 } });
    await expect(updateInvoice(tenantId, actorId, invoice.id, { notes: "No" })).rejects.toThrow("Only unpaid");
  });
});
