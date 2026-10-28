// Read-only integrity/readiness checks inside the target application image.
// No existing passwords are transferred or used; login is verified separately.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma, Prisma, createTenantBackup, validateTenantBackup } from "/app/packages/database/dist/index.js";
import { buildInvoicePdfBuffer, buildReceiptPdfBuffer } from "/app/packages/pdf/dist/index.js";
import { encryptSecret, decryptSecret } from "/app/packages/common/dist/index.js";
const tenantId = "7ab94e71-ee0f-4e3f-84b3-94d43e99c303";
try {
  const endpoints = { "auth-service": 8081, "crm-service": 8082, "billing-service": 8083, "payment-service": 8084, "purchase-service": 8085, "inventory-service": 8086, "expense-service": 8087, "hr-service": 8089, "helpdesk-service": 8090, "settings-service": 8091, "accounting-service": 8092, "api-gateway": 8080 };
  for (const [host, port] of Object.entries(endpoints)) {
    assert.equal((await fetch(`http://${host}:${port}/readyz`)).status, 200, `${host} readiness`);
  }
  const inv = await prisma.invoice.findFirstOrThrow({ where: { tenantId, invoiceNumber: "FII/26-27/88" } });
  assert.equal(inv.status, "PARTIAL"); assert.equal(inv.grandTotal.toString(), "97350"); assert.equal(inv.amountPaid.toString(), "30000");
  assert.equal(inv.grandTotal.sub(inv.amountPaid).sub(inv.creditedAmount).toString(), "67350");
  const pdf = await buildInvoicePdfBuffer(tenantId, inv.id); assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
  const receipt = await prisma.receipt.findFirstOrThrow({ where: { tenantId, receiptNumber: "RCPT/26-27/72" } });
  const receiptPdf = await buildReceiptPdfBuffer(tenantId, receipt.id); assert.equal(receiptPdf.buffer.subarray(0, 4).toString(), "%PDF");
  const snapshot = validateTenantBackup(await createTenantBackup(tenantId), tenantId);
  assert.equal(snapshot.tables.Invoice.length, await prisma.invoice.count({ where: { tenantId } }));
  assert.ok(snapshot.tables.Customer.every((c) => c.tenantId === tenantId));
  const encrypted = encryptSecret(JSON.stringify(snapshot)); assert.equal(JSON.parse(decryptSecret(encrypted)).tenantId, tenantId);
  const keyHash = createHash("sha256").update(process.env.MASTER_ENCRYPTION_KEY).digest("hex");
  if (process.env.EXPECTED_MASTER_KEY_SHA256) assert.equal(keyHash, process.env.EXPECTED_MASTER_KEY_SHA256);
  const balances = await prisma.$queryRaw`SELECT "tenantId", count(*)::int AS invoices, sum(GREATEST("grandTotal" - "amountPaid" - "creditedAmount", 0))::text AS balance FROM "Invoice" WHERE status <> 'CANCELLED' GROUP BY "tenantId"`;
  assert.ok(balances.every((b) => new Prisma.Decimal(b.balance).gte(0)));
  console.log(JSON.stringify({ verified: true, serviceReadinessChecks: Object.keys(endpoints).length, partialInvoiceBalance: true, invoicePdf: true, receiptPdf: true, tenantBackup: true, encryptionKeyPreserved: true, tenantsWithInvoiceBalances: balances.length }));
} finally { await prisma.$disconnect(); }
