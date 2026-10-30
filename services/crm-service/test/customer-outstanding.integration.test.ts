import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@fii/database";
import { listCustomers } from "../src/services/customer.service.js";

const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("customer list current outstanding", () => {
  let tenantId = "", otherId = "", customerId = "", creditId = "";
  beforeAll(async () => {
    const stamp = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: "Balance test", subdomain: `balance-${stamp}` } })).id;
    otherId = (await prisma.tenant.create({ data: { name: "Other balance test", subdomain: `balance-other-${stamp}` } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "LISOFT-C-42", name: "Owing", openingBalance: "100.10" } })).id;
    creditId = (await prisma.customer.create({ data: { tenantId, code: "CREDIT", name: "Credit", openingBalance: "-10.01" } })).id;
    const base = { partyType: "CUSTOMER" as const, partyId: customerId, fyCode: "2026-27", entryDate: new Date(), entryType: "INVOICE" as const, refType: "INVOICE", refId: customerId };
    await prisma.ledgerEntry.createMany({ data: [
      { ...base, tenantId, debit: "150.20", credit: "0" },
      { ...base, tenantId, debit: "0", credit: "40.05", entryType: "PAYMENT", refType: "PAYMENT" },
      { ...base, tenantId: otherId, debit: "9999", credit: "0" },
      { ...base, tenantId, partyType: "SUPPLIER", debit: "8888", credit: "0" },
    ] });
    await prisma.legacyRecord.create({ data: { id: randomUUID(), tenantId, sourceHash: "balance-test", sourceTable: "user_bills", sourceId: "42", status: "REVIEW", data: { billto: "42" } } });
    const invoice = { tenantId, customerId, fyCode: "2026-27", invoiceDate: new Date(), dueDate: new Date(), placeOfSupply: "33", subTotal: "400", taxableValue: "400", grandTotal: "400" };
    await prisma.invoice.createMany({ data: [
      { ...invoice, invoiceNumber: "PARTIAL", amountPaid: "40.05", creditedAmount: "49.70", status: "PARTIAL" },
      { ...invoice, invoiceNumber: "PAID", amountPaid: "400", status: "PAID" },
      { ...invoice, invoiceNumber: "CANCELLED", status: "CANCELLED" },
      { ...invoice, invoiceNumber: "CREDITED", creditedAmount: "400", status: "UNPAID" },
    ] });
  });
  afterAll(async () => {
    await prisma.paymentAllocation.deleteMany({ where: { payment: { tenantId } } });
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.legacyRecord.deleteMany({ where: { tenantId } });
    await prisma.invoice.deleteMany({ where: { tenantId } });
    await prisma.ledgerEntry.deleteMany({ where: { tenantId: { in: [tenantId, otherId] } } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } });
    await prisma.$disconnect();
  });
  it("counts only invoices with a remaining balance after payments and credits; retains the separate ledger balance", async () => {
    const result = await listCustomers(tenantId, { page: 1, limit: 20 });
    expect(result.items.find((item) => item.id === customerId)).toMatchObject({ currentOutstanding: "410.35", ledgerOutstanding: "210.25", invoiceCount: 1, heldInvoiceCount: 1 });
    expect(result.items.find((item) => item.id === creditId)).toMatchObject({ currentOutstanding: "-10.01", ledgerOutstanding: "-10.01", invoiceCount: 0, heldInvoiceCount: 0 });
  });
  it("respects search and does not return another tenant's customers", async () => {
    expect((await listCustomers(tenantId, { page: 1, limit: 1, search: "Credit" })).items.map((item) => item.id)).toEqual([creditId]);
    expect((await listCustomers(otherId, { page: 1, limit: 20 })).items).toEqual([]);
  });
  it("keeps review warnings linked by customer ID when the display code changes", async () => {
    await prisma.legacyRecord.create({ data: { id: randomUUID(), tenantId, sourceHash: "balance-test", sourceTable: "user_cust_vendor_details", sourceId: "42", status: "IMPORTED", targetModel: "Customer", targetId: customerId, data: {} } });
    await prisma.customer.update({ where: { id: customerId }, data: { code: "CUST-00001" } });
    expect((await listCustomers(tenantId, { page: 1, limit: 20 })).items.find((item) => item.id === customerId)?.heldInvoiceCount).toBe(1);
  });
  it("includes opening-only customers and deducts only successful unallocated receipts", async () => {
    const opening = await prisma.customer.create({ data: { tenantId, code: "OPENING", name: "SPT fixture", openingBalance: "1500" } });
    const query = { page: 1, limit: 20, balance: "due" as const, sortBy: "outstanding" as const, order: "desc" as const };
    expect((await listCustomers(tenantId, query)).items[0]).toMatchObject({ id: opening.id, currentOutstanding: "1500.00", invoiceCount: 0 });
    await prisma.payment.createMany({ data: [
      { tenantId, customerId: opening.id, fyCode: "2026-27", amount: "500", mode: "CASH", status: "SUCCESS", paymentDate: new Date() },
      { tenantId, customerId: opening.id, fyCode: "2026-27", amount: "800", mode: "CASH", status: "FAILED", paymentDate: new Date() },
    ] });
    expect((await listCustomers(tenantId, query)).items[0]).toMatchObject({ id: opening.id, currentOutstanding: "1000.00", invoiceCount: 0 });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenantId, invoiceNumber: "PARTIAL" } });
    const allocated = await prisma.payment.create({ data: { tenantId, customerId, fyCode: "2026-27", amount: "40.05", mode: "CASH", status: "SUCCESS", paymentDate: new Date() } });
    await prisma.paymentAllocation.create({ data: { paymentId: allocated.id, invoiceId: invoice.id, amount: "40.05" } });
    expect((await listCustomers(tenantId, query)).items.find((row) => row.id === customerId)?.currentOutstanding).toBe("410.35");
  });
});
