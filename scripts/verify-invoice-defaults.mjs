import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { Prisma } = createRequire(new URL("../packages/database/package.json", import.meta.url))("@prisma/client");
assert.ok(process.env.LEGACY_FII_LOGIN_PASSWORD, "Existing FII administrator password required");
const root = "http://localhost:8000/api/v1";
const response = await fetch(`${root}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "X-FII-Console": "tenant" }, body: JSON.stringify({ email: "admin@demo.local", password: process.env.LEGACY_FII_LOGIN_PASSWORD }) });
assert.equal(response.status, 200);
const { accessToken } = await response.json();
const headers = { authorization: `Bearer ${accessToken}`, "X-FII-Console": "tenant" };
async function get(path) { const result = await fetch(root + path, { headers }); assert.equal(result.status, 200, path); return result.json(); }
const active = (await get("/financial-years")).find((fy) => fy.isActive);
assert.ok(active);
const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const today = ["year", "month", "day"].map((type) => parts.find((part) => part.type === type).value).join("-");
const params = new URLSearchParams({ limit: "100", fyCode: active.code, from: active.startDate.slice(0, 10), to: today });
const all = await get(`/invoices?${params}`);
assert.ok(all.total <= 100, "Expand verification pagination if this fixture grows");
for (const status of ["OUTSTANDING", "PAID", "CANCELLED"]) {
  const list = await get(`/invoices?${params}&status=${status}`);
  const expected = all.items.filter((row) => status === "OUTSTANDING" ? ["UNPAID", "PARTIAL"].includes(row.status) : row.status === status);
  assert.deepEqual(list.items.map((row) => row.id).sort(), expected.map((row) => row.id).sort());
  for (const row of list.items) {
    const remaining = row.status === "CANCELLED" ? new Prisma.Decimal(0) : Prisma.Decimal.max(new Prisma.Decimal(row.grandTotal).sub(row.amountPaid).sub(row.creditedAmount), 0);
    assert.equal(row.balance, remaining.toFixed(2));
  }
}
const talco = await get(`/invoices?${params}&status=OUTSTANDING&search=FII%2F26-27%2F88`);
assert.equal(talco.total, 1);
assert.equal(talco.items[0].balance, "67350.00");
console.log(`PASS: FY ${active.code}, ${active.startDate.slice(0, 10)} through ${today}; unpaid + partial, paid/cancelled filters, exact balances; TALCO /88 balance INR 67,350.00`);
