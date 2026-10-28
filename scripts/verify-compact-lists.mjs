import assert from "node:assert/strict";
assert.ok(process.env.LEGACY_FII_LOGIN_PASSWORD, "Existing FII administrator password is required");
const root = "http://localhost:8000/api/v1";
const login = await fetch(`${root}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "X-FII-Console": "tenant" }, body: JSON.stringify({ email: "admin@demo.local", password: process.env.LEGACY_FII_LOGIN_PASSWORD }) });
assert.equal(login.status, 200);
const { accessToken } = await login.json();
const headers = { authorization: `Bearer ${accessToken}`, "X-FII-Console": "tenant" };
const resources = ["customers", "suppliers", "invoices", "payments", "products", "employees", "users", "subscribers", "complaints", "tasks", "expenses", "purchase-invoices", "purchase-orders", "purchase-returns", "credit-notes", "debit-notes", "notification-logs", "audit-logs", "billing-runs", "settings/legacy-imports/records"];
for (const resource of resources) {
  for (const limit of [10, 25, 100]) {
    const response = await fetch(`${root}/${resource}?page=1&limit=${limit}`, { headers });
    assert.equal(response.status, 200, resource);
    const data = await response.json();
    assert.equal(data.limit, limit, `${resource}: requested limit`);
    assert.ok(Array.isArray(data.items) && data.items.length === Math.min(limit, data.total), `${resource}: row count`);
  }
  console.log(`PASS: ${resource} rows-per-page 10/25/100`);
}
const talco = await (await fetch(`${root}/customers?search=TALCO`, { headers })).json();
assert.equal(talco.items.length, 1);
assert.equal(talco.items[0].invoiceCount, 2);
assert.equal(talco.items[0].currentOutstanding, "70890.00");
console.log("PASS: TALCO has 2 outstanding invoices and INR 70,890.00 remaining");
