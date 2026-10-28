import assert from "node:assert/strict";
assert.ok(process.env.LEGACY_FII_LOGIN_PASSWORD, "Existing administrator password required");
const root = "http://localhost:8000/api/v1";
const login = await fetch(`${root}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "X-FII-Console": "tenant" }, body: JSON.stringify({ email: "admin@demo.local", password: process.env.LEGACY_FII_LOGIN_PASSWORD }) });
assert.equal(login.status, 200);
const { accessToken } = await login.json();
const headers = { authorization: `Bearer ${accessToken}`, "X-FII-Console": "tenant" };
async function get(path, params) {
  const response = await fetch(`${root}/${path}?${new URLSearchParams(params)}`, { headers });
  assert.equal(response.status, 200, path);
  return response.json();
}
const yearsResponse = await fetch(`${root}/financial-years`, { headers });
assert.equal(yearsResponse.status, 200);
const years = await yearsResponse.json(), active = years.find((fy) => fy.isActive);
const cases = [
  ["payments", "paymentDate", ["SUCCESS", "FAILED"]],
  ["purchase-invoices", "invoiceDate", ["OUTSTANDING", "PAID", "CANCELLED"]],
  ["purchase-orders", "orderDate", ["SENT", "CANCELLED"]],
  ["purchase-returns", "returnDate", []],
  ["credit-notes", "noteDate", ["ISSUED", "CANCELLED"]],
  ["debit-notes", "noteDate", ["ISSUED", "CANCELLED"]],
  ["expenses", "expenseDate", ["RECORDED", "CANCELLED"]],
];
for (const [resource, dateField, statuses] of cases) {
  const base = resource === "expenses" ? { status: "ALL" } : {};
  const all = [];
  for (let page = 1; ; page++) {
    const data = await get(resource, { ...base, page: String(page), limit: "100" });
    all.push(...data.items);
    if (all.length >= data.total) break;
    assert.ok(data.items.length, "Unexpected empty page");
  }
  for (const fyCode of new Set([active.code, ...all.slice(0, 1).map((row) => row.fyCode)])) {
    const year = years.find((fy) => fy.code === fyCode);
    const from = year.startDate.slice(0, 10), to = year.endDate.slice(0, 10);
    const expected = all.filter((row) => row.fyCode === fyCode && row[dateField].slice(0, 10) >= from && row[dateField].slice(0, 10) <= to);
    const filtered = await get(resource, { ...base, fyCode, from, to, limit: "100" });
    assert.equal(filtered.total, expected.length, `${resource}: period total`);
    assert.deepEqual(filtered.items.map((row) => row.id).sort(), expected.slice(0, 100).map((row) => row.id).sort(), `${resource}: filtered records`);
    for (const status of statuses) {
      const result = await get(resource, { fyCode, from, to, status, limit: "100" });
      assert.equal(result.total, expected.filter((row) => status === "OUTSTANDING" ? ["UNPAID", "PARTIAL"].includes(row.status) : row.status === status).length, `${resource}: status ${status}`);
    }
  }
  console.log(`PASS: ${resource} FY/date/status filters against ${all.length} live records`);
}
