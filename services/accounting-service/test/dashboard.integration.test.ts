import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { businessDashboard, dashboardDates } from "../src/dashboard.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("full business dashboard", () => {
  let tenantId = "", otherId = "", emptyId = "", customerId = "";
  const now = new Date("2026-10-31T01:00:00Z");
  beforeAll(async () => {
    const suffix = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: "Dashboard", subdomain: `dash-${suffix}` } })).id;
    otherId = (await prisma.tenant.create({ data: { name: "Other", subdomain: `dash-other-${suffix}` } })).id;
    emptyId = (await prisma.tenant.create({ data: { name: "Empty", subdomain: `dash-empty-${suffix}` } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31T23:59:59.999Z"), isActive: true } });
    customerId = (await prisma.customer.create({ data: { tenantId, code: "C1", name: "Opening balance buyer", openingBalance: 1500 } })).id;
    await prisma.customer.create({ data: { tenantId, code: "C2", name: "Credit customer", openingBalance: -200 } });
    await prisma.customer.create({ data: { tenantId, code: "C3", name: "Inactive debtor", isActive: false, openingBalance: 100 } });
    const futureId = (await prisma.customer.create({ data: { tenantId, code: "CF", name: "Future offset", openingBalance: -2000 } })).id;
    const otherCustomer = (await prisma.customer.create({ data: { tenantId: otherId, code: "OTHER", name: "Private", openingBalance: 99999 } })).id;
    const invoice = { tenantId, customerId, fyCode: "2026-27", invoiceType: "MANUAL" as const, invoiceDate: new Date("2026-10-15"), dueDate: new Date("2026-10-20"), placeOfSupply: "33", subTotal: 1000, taxableValue: 1000, grandTotal: 1000, status: "UNPAID" as const };
    const gst = await prisma.invoice.create({ data: { ...invoice, invoiceNumber: "GST", status: "PARTIAL", amountPaid: 300, creditedAmount: 100 } });
    await prisma.invoice.createMany({ data: [
      { ...invoice, invoiceNumber: "NG", chargeGst: false, grandTotal: 500, invoiceDate: new Date("2026-10-31"), dueDate: new Date("2026-11-05") },
      { ...invoice, invoiceNumber: "OLD", fyCode: "2025-26", invoiceDate: new Date("2026-03-01"), dueDate: new Date("2026-03-10"), grandTotal: 100 },
      { ...invoice, invoiceNumber: "DRAFT", status: "DRAFT", grandTotal: 9000 },
      { ...invoice, invoiceNumber: "CANCELLED", status: "CANCELLED", grandTotal: 9000 },
      { ...invoice, invoiceNumber: "FUTURE", customerId: futureId, invoiceDate: new Date("2026-11-02"), dueDate: new Date("2026-11-15"), grandTotal: 2000 },
      { ...invoice, invoiceNumber: "PRIVATE", tenantId: otherId, customerId: otherCustomer, grandTotal: 99999 },
    ] });
    const payment = await prisma.payment.create({ data: { tenantId, customerId, fyCode: "2026-27", amount: 350, status: "SUCCESS", mode: "CASH", paymentDate: new Date("2026-10-30T20:00:00Z") } });
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: gst.id, amount: 300 } });
    await prisma.payment.createMany({ data: [
      { tenantId, customerId, fyCode: "2026-27", amount: 100, status: "SUCCESS", mode: "CASH", paymentDate: new Date("2026-10-30T17:59:00Z") },
      { tenantId, customerId, fyCode: "2026-27", amount: 50000, status: "FAILED", mode: "CASH", paymentDate: new Date("2026-10-31T00:00:00Z") },
      { tenantId: otherId, customerId: otherCustomer, fyCode: "2026-27", amount: 50000, status: "SUCCESS", mode: "CASH", paymentDate: now },
    ] });
    const categoryId = (await prisma.expenseCategory.create({ data: { tenantId, name: "Operating" } })).id;
    await prisma.expense.createMany({ data: [{ tenantId, categoryId, fyCode: "2026-27", expenseDate: new Date("2026-10-31"), description: "Operating expense", amount: 100, total: 100, mode: "CASH", status: "RECORDED" }, { tenantId, categoryId, fyCode: "2026-27", expenseDate: new Date("2026-10-31"), description: "Cancelled", amount: 9999, total: 9999, mode: "CASH", status: "CANCELLED" }] });
    const supplierId = (await prisma.supplier.create({ data: { tenantId, code: "S1", name: "Supplier" } })).id;
    await prisma.purchaseInvoice.createMany({ data: [{ tenantId, supplierId, billNumber: "PB1", ourNumber: "P1", fyCode: "2026-27", invoiceDate: new Date("2026-10-31"), subTotal: 500, taxableValue: 500, grandTotal: 500 }, { tenantId, supplierId, billNumber: "PB2", ourNumber: "P2", fyCode: "2026-27", invoiceDate: new Date("2026-10-31"), subTotal: 9999, taxableValue: 9999, grandTotal: 9999, status: "CANCELLED" }] });
    await prisma.subscriber.createMany({ data: [{ tenantId, customerId, code: "S1", subscriberType: "PREPAID", activationDate: now, chargeGst: true }, { tenantId, customerId, code: "S2", subscriberType: "POSTPAID", activationDate: now, chargeGst: false }, { tenantId, customerId, code: "S3", subscriberType: "PREPAID", activationDate: now, status: "SUSPENDED" }] });
    await prisma.product.createMany({ data: [{ tenantId, sku: "LOW", name: "Low", stockQty: 2, reorderLevel: 5 }, { tenantId, sku: "SERVICE", name: "Service", isService: true, stockQty: 0, reorderLevel: 5 }, { tenantId, sku: "INACTIVE", name: "Inactive", isActive: false, stockQty: 0, reorderLevel: 5 }] });
    await prisma.complaint.createMany({ data: [{ tenantId, customerId, complaintNumber: "OPEN", type: "BILLING", subject: "Open" }, { tenantId, customerId, complaintNumber: "DONE", type: "BILLING", subject: "Done", status: "RESOLVED" }] });
    await prisma.task.createMany({ data: [{ tenantId, title: "Late", dueDate: new Date("2026-10-29") }, { tenantId, title: "Done", dueDate: new Date("2026-10-29"), status: "COMPLETED" }] });
    await prisma.salesDocument.createMany({ data: ["QUOTATION", "PROFORMA"].map(kind => ({ tenantId, customerId, kind, documentNumber: kind, fyCode: "2026-27", documentDate: new Date("2026-10-31"), validUntil: new Date("2026-11-15"), placeOfSupply: "33", isInterState: false, items: [], totals: {}, grandTotal: 100000, createdById: "test" })) });
    await prisma.legacyRecord.create({ data: { id: `held-${tenantId}`, tenantId, sourceHash: "test", sourceTable: "user_bills", sourceId: "1", status: "REVIEW", data: {} } });
  });
  afterAll(async () => {
    await prisma.paymentAllocation.deleteMany({ where: { payment: { tenantId: { in: [tenantId, otherId, emptyId] } } } });
    for (const model of ["legacyRecord", "salesDocument", "complaint", "task", "subscriber", "expense", "expenseCategory", "purchaseInvoice", "supplier", "payment", "invoice", "product", "customer", "financialYear"] as const) await prisma[model].deleteMany({ where: { tenantId: { in: [tenantId, otherId, emptyId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId, emptyId] } } }); await prisma.$disconnect();
  });
  it("uses India midnight for receipts and excludes cancelled/draft/non-accounting documents", async () => {
    expect(dashboardDates(new Date("2026-10-30T20:00:00Z")).today).toBe("2026-10-31");
    const d = await businessDashboard(tenantId, now);
    expect(d.todayCollection).toBe(350); expect(d.todayReceiptCount).toBe(1); expect(d.monthCollections).toBe(450);
    expect(d.mtdSales).toBe(1500); expect(d.fiscalSales).toBe(1500); expect(d.fiscalInvoiceCount).toBe(2); expect(d.fiscalCollections).toBe(450);
    expect(d.monthly.at(-1)).toMatchObject({ month: "2026-10", sales: 1500, collected: 450, gstSales: 1000, withoutGstSales: 500 });
  });
  it("includes opening balances, old-FY debt and unapplied receipts without netting other customer credits", async () => {
    const d = await businessDashboard(tenantId, now);
    expect(d.outstanding).toBe(2650); expect(d.customerCredit).toBe(200); expect(d.dueCustomers).toBe(2);
    expect(d.topCustomers[0]).toMatchObject({ id: customerId, amount: 2550, invoiceCount: 3 });
    expect(d.overdue).toEqual({ amount: 700, count: 2 }); expect(d.aging.notDue.amount).toBe(500);
    expect(d.heldInvoices).toBe(1);
  });
  it("shows expenses, purchases, subscriptions, support and inventory without other-tenant data", async () => {
    const d = await businessDashboard(tenantId, now);
    expect(d.monthExpenses).toBe(100); expect(d.monthPurchases).toBe(500); expect(d.purchaseBillsDue).toBe(500);
    expect(d.subscribers).toMatchObject({ active: 2, gst: 1, withoutGst: 1, suspended: 1 });
    expect(d.customers).toEqual({ active: 3, inactive: 1 }); expect(d.openComplaints).toBe(1); expect(d.lowStock).toBe(1); expect(d.overdueTasks).toBe(1);
    expect(d.quotations).toEqual({ count: 1, amount: 100000 }); expect(d.proformas.count).toBe(1);
    expect(d.recentPayments).toHaveLength(2);
  });
  it("returns honest empty-state figures without an active financial year", async () => {
    const d = await businessDashboard(emptyId, now); expect(d.financialYear).toBeNull(); expect(d.fiscalSales).toBeNull(); expect(d.outstanding).toBe(0); expect(d.topCustomers).toEqual([]); expect(d.monthly).toHaveLength(6); expect(d.recentPayments).toEqual([]);
  });
});
