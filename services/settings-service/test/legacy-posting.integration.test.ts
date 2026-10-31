import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { legacySalesBody, postLegacySales, previewLegacySales } from "../src/legacy-posting.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("explicit reconciled legacy sales posting", () => {
  let tenantId = "", customerId = "", actorId = "";
  const parentId = randomUUID(), receiptId = randomUUID(), sourceHash = "test-source-hash";
  const input = () => legacySalesBody.parse({ customerId, invoiceNumber: "LEGACY-001", invoiceDate: "2026-05-01", dueDate: "2026-05-10", chargeGst: true, isInterState: false,
    expectedTotal: 118, expectedBalance: 18, note: "Verified invoice and bank advice; separately confirmed TDS deduction", items: [{ description: "Verified service", hsnSac: "998422", quantity: 1, unitPrice: 100, discount: 0, gstRate: 18 }],
    receipts: [{ sourceRecordId: receiptId, receiptNumber: "LEGACY-R1", paymentDate: "2026-05-05", amount: 90, tdsAmount: 10, mode: "BANK_TRANSFER", reference: "Verified-UTR" }] });
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Legacy posting test", subdomain: `legacy-post-${Date.now()}`, stateCode: "33" } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, name: "Reviewer", email: "legacy-post@example.test", passwordHash: "not-a-login" } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, name: "Mapped customer", code: "C1", stateCode: "33" } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isActive: true } });
    await prisma.legacyRecord.createMany({ data: [
      { id: parentId, tenantId, sourceHash, sourceTable: "user_bills", sourceId: "1", status: "REVIEW", data: { billto: "42", billmode: "PAID" } },
      { id: receiptId, tenantId, sourceHash, sourceTable: "user_receipt", sourceId: "2", status: "REVIEW", data: { receipt_bill_id: "1" } },
      { id: randomUUID(), tenantId, sourceHash, sourceTable: "user_cust_vendor_details", sourceId: "42", status: "IMPORTED", targetModel: "customer", targetId: customerId, data: {} },
    ] });
    await prisma.setting.create({ data: { tenantId, group: "LEGACY_REVIEW_APPROVAL", key: parentId, value: JSON.stringify({ approved: true, sourceHash, note: "Reviewed original invoice and receipts" }) } });
  });
  afterAll(async () => {
    const where = { tenantId };
    await prisma.auditLog.deleteMany({ where }); await prisma.setting.deleteMany({ where }); await prisma.legacyRecord.deleteMany({ where });
    await prisma.dayBookEntry.deleteMany({ where }); await prisma.ledgerEntry.deleteMany({ where }); await prisma.receipt.deleteMany({ where });
    await prisma.paymentAllocation.deleteMany({ where: { payment: where } }); await prisma.payment.deleteMany({ where }); await prisma.invoiceItem.deleteMany({ where: { invoice: where } }); await prisma.invoice.deleteMany({ where });
    await prisma.customer.deleteMany({ where }); await prisma.financialYear.deleteMany({ where }); await prisma.user.deleteMany({ where }); await prisma.tenant.delete({ where: { id: tenantId } }); await prisma.$disconnect();
  });
  it("requires every source receipt, matching balances and approval without writing in preview", async () => {
    await expect(previewLegacySales(tenantId,parentId,{ ...input(), receipts: [] })).rejects.toThrow("every held linked receipt");
    await expect(previewLegacySales(tenantId,parentId,{ ...input(), expectedBalance: 0 })).rejects.toThrow("verified balance");
    const preview = await previewLegacySales(tenantId,parentId,input());
    expect(preview).toMatchObject({ total: "118.00", settlement: "100.00", balance: "18.00" });
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(0);
    await expect(postLegacySales(tenantId,actorId,parentId,input(),"stale-token","backup-file-reference")).rejects.toThrow("stale");
  });
  it("posts the complete financial document atomically, preserving actual cash and blocking repeats", async () => {
    const preview = await previewLegacySales(tenantId,parentId,input());
    const posted = await postLegacySales(tenantId,actorId,parentId,input(),preview.token,"backup-file-reference");
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: posted.invoiceId } });
    expect(invoice.status).toBe("PARTIAL"); expect(Number(invoice.amountPaid)).toBe(100);
    expect(Number((await prisma.dayBookEntry.findFirstOrThrow({ where: { tenantId } })).amount)).toBe(90);
    expect(await prisma.outboxEvent.count({ where: { tenantId } })).toBe(0);
    expect((await prisma.legacyRecord.findUniqueOrThrow({ where: { id: parentId } })).status).toBe("IMPORTED");
    await expect(postLegacySales(tenantId,actorId,parentId,input(),preview.token,"backup-file-reference")).rejects.toThrow("unposted held");
  });
});
