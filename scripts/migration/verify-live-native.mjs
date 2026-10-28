import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { Prisma } = createRequire(new URL("../../packages/database/package.json", import.meta.url))("@prisma/client");
const packet = JSON.parse(readFileSync("reports/migration/lisoft/native-import.json", "utf8"));
const fii = packet.companies.find((company) => company.mapping.oldCompanyId === "1");
assert.ok(process.env.LEGACY_FII_LOGIN_PASSWORD, "Provide the existing FII administrator password");
async function request(path, token, body, expected = 200) {
  const response = await fetch(`http://localhost:8000/api/v1${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "X-FII-Console": "tenant", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.equal(response.status, expected, `${path}: ${data.error?.message ?? "unexpected response"}`); return data;
}
const login = await request("/auth/login", null, { email: "admin@demo.local", password: process.env.LEGACY_FII_LOGIN_PASSWORD });
const token = login.accessToken;
const customers = await request("/customers?limit=100", token);
assert.equal(customers.total, fii.rows.customer.length);
for (const customer of customers.items) {
  const expectedLedger = fii.rows.ledgerEntry.filter((row) => row.partyType === "CUSTOMER" && row.partyId === customer.id)
    .reduce((sum, row) => sum.add(row.debit).sub(row.credit), new Prisma.Decimal(customer.openingBalance));
  const due = fii.rows.invoice.filter((row) => row.customerId === customer.id && row.status !== "CANCELLED")
    .map((row) => Prisma.Decimal.max(new Prisma.Decimal(row.grandTotal).sub(row.amountPaid).sub(row.creditedAmount ?? 0), 0)).filter((amount) => amount.gt(0));
  const expected = due.reduce((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
  assert.equal(customer.currentOutstanding, expected.toFixed(2), `Customer balance mismatch: ${customer.code}`);
  assert.equal(customer.ledgerOutstanding, expectedLedger.toFixed(2), `Ledger balance mismatch: ${customer.code}`);
  assert.equal(customer.invoiceCount, due.length, `Outstanding invoice count mismatch: ${customer.code}`);
  const oldParty = customer.code.replace(/^LISOFT-C-/, "");
  const heldCount = fii.rows.legacyRecord.filter((row) => row.sourceTable === "user_bills" && row.status === "REVIEW" && row.data.billto === oldParty).length;
  assert.equal(customer.heldInvoiceCount, heldCount, `Held invoice warning mismatch: ${customer.code}`);
}
assert.equal((await request("/invoices?limit=100", token)).total, fii.rows.invoice.length);
assert.equal((await request("/payments?limit=100", token)).total, fii.rows.payment.length);
const summary = await request("/settings/legacy-imports/summary", token);
assert.equal(summary.groups.reduce((total, group) => total + group.count, 0), fii.rows.legacyRecord.length);
assert.equal(summary.manifest.nativeCounts.invoice, 850);
assert.equal((await request("/settings/legacy-imports/records?status=REVIEW", token)).total, fii.summary.archiveStatusCounts.REVIEW);
const foreignRecord = packet.companies.find((company) => company.mapping.oldCompanyId === "30").rows.legacyRecord[0];
await request(`/settings/legacy-imports/records/${foreignRecord.id}`, token, undefined, 404);
await request("/settings/legacy-imports/summary", null, undefined, 401);
const customersWithoutPhone = new Set(fii.rows.customer.filter((row) => row.phone === null).map((row) => row.id));
const invoice = fii.rows.invoice.find((row) => customersWithoutPhone.has(row.customerId) && row.status !== "CANCELLED");
assert.ok(invoice);
const pdf = await fetch(`http://localhost:8000/api/v1/invoices/${invoice.id}/pdf`, { headers: { authorization: `Bearer ${token}` } });
assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
console.log("PASS: all customer current balances and held-invoice warnings, live customer/invoice/payment counts, legacy review archive, tenant isolation, authentication and historical invoice PDF");
