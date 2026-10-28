// Run in the target auth-service container; credentials arrive on encrypted stdin.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { prisma } from "/app/packages/database/dist/index.js";
import { decryptSecret } from "/app/packages/common/dist/index.js";
const input = JSON.parse(readFileSync(0, "utf8"));
const base = "http://api-gateway:8080/api/v1";
try {
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-FII-Console": "tenant" }, body: JSON.stringify({ email: input.email, password: input.password }) });
  assert.equal(login.status, 200, "Tenant login failed");
  const session = await login.json(); const headers = { Authorization: `Bearer ${session.accessToken}`, "X-FII-Console": "tenant" };
  const get = async (path) => { const r = await fetch(base + path, { headers }); assert.equal(r.status, 200, path); return r.json(); };
  const license = await get("/settings/license"); assert.ok(license);
  const invoices = await get("/invoices?search=FII%2F26-27%2F88");
  assert.equal(invoices.total, 1); const invoice = invoices.items[0];
  assert.equal(Number(invoice.grandTotal), 97350); assert.equal(Number(invoice.amountPaid), 30000); assert.equal(Number(invoice.balance), 67350); assert.equal(invoice.status, "PARTIAL");
  const pdf = await fetch(`${base}/invoices/${invoice.id}/pdf`, { headers }); assert.equal(pdf.status, 200); const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  const backup = await fetch(`${base}/backup/download`, { headers }); assert.equal(backup.status, 200);
  const payload = await backup.text(); const prefix = "FII-TENANT-BACKUP-1\n"; assert.ok(payload.startsWith(prefix));
  const content = JSON.parse(decryptSecret(payload.slice(prefix.length)));
  assert.equal(content.tenantId, "7ab94e71-ee0f-4e3f-84b3-94d43e99c303");
  assert.equal(content.tables.Invoice.length, await prisma.invoice.count({ where: { tenantId: content.tenantId } }));
  assert.ok(content.tables.Customer.every((c) => c.tenantId === content.tenantId));
  const year = await prisma.financialYear.findFirstOrThrow({ where: { tenantId: content.tenantId, isActive: true } });
  const daybook = await get(`/day-book?fyCode=${year.code}&from=${year.startDate.toISOString().slice(0, 10)}&to=2026-10-28`); assert.ok(daybook);
  let platformVerified = false;
  if (input.platformPassword) {
    const auth = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-FII-Console": "platform" }, body: JSON.stringify({ email: "superadmin@platform.local", password: input.platformPassword }) });
    assert.equal(auth.status, 200, "Platform login failed"); const admin = await auth.json();
    const tenants = await fetch(`${base}/platform/tenants`, { headers: { Authorization: `Bearer ${admin.accessToken}`, "X-FII-Console": "platform" } }); assert.equal(tenants.status, 200); platformVerified = true;
  }
  console.log(JSON.stringify({ verified: true, tenantLogin: true, platformLogin: platformVerified, partialInvoiceBalance: true, invoicePdf: true, tenantBackup: true, dayBook: true, originalEncryptionKeyHash: createHash("sha256").update(process.env.MASTER_ENCRYPTION_KEY).digest("hex") }));
} finally { await prisma.$disconnect(); }
