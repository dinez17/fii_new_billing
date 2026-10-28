import assert from "node:assert/strict";
assert.ok(process.env.LEGACY_FII_LOGIN_PASSWORD, "Existing FII administrator password is required");
const base = "http://localhost:8000/api/v1";
let token;
async function request(path, expected = 200, body) {
  const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "X-FII-Console": "tenant", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data.error ?? data).slice(0, 150)}`);
  return data;
}
token = (await request("/auth/login", 200, { email: "admin@demo.local", password: process.env.LEGACY_FII_LOGIN_PASSWORD })).accessToken;
for (const resource of ["customers", "suppliers"]) {
  const all = await request(`/${resource}?limit=100`);
  assert.ok(all.total > 1 && all.total <= 100, "This verification expects the current FII fixture size");
  assert.equal(all.items.length, all.total);
  for (const item of all.items) {
    assert.equal(item.tenantId, "7ab94e71-ee0f-4e3f-84b3-94d43e99c303");
    assert.equal(typeof item.invoiceCount, "number");
    assert.match(item.currentOutstanding, /^-?\d+\.\d{2}$/);
  }
  for (const sortBy of ["outstanding", "invoiceCount"]) {
    for (const order of ["asc", "desc"]) {
      const result = await request(`/${resource}?limit=100&sortBy=${sortBy}&order=${order}`);
      const field = sortBy === "outstanding" ? "currentOutstanding" : "invoiceCount";
      for (let i = 1; i < result.items.length; i++) {
        const change = Number(result.items[i][field]) - Number(result.items[i - 1][field]);
        assert.ok(order === "asc" ? change >= 0 : change <= 0, `${resource} ${sortBy} ${order}`);
      }
      for (const page of [1, 2]) {
        const one = await request(`/${resource}?limit=1&page=${page}&sortBy=${sortBy}&order=${order}`);
        assert.equal(one.items[0].id, result.items[page - 1].id, "Sorting must precede pagination");
      }
    }
  }
  for (const activity of ["all", "active", "inactive"]) {
    for (const balance of ["all", "due", "settled", "credit"]) {
      const expected = all.items.filter((item) => (activity === "all" || item.isActive === (activity === "active")) &&
        (balance === "all" || (balance === "due" ? Number(item.currentOutstanding) > 0 : balance === "credit" ? Number(item.currentOutstanding) < 0 : Number(item.currentOutstanding) === 0)));
      const result = await request(`/${resource}?limit=100&activity=${activity}&balance=${balance}`);
      assert.equal(result.total, expected.length);
      assert.deepEqual(result.items.map((item) => item.id).sort(), expected.map((item) => item.id).sort());
    }
  }
  await request(`/${resource}?activity=invalid`, 400);
  await request(`/${resource}?sortBy=invalid`, 400);
  const search = await request(`/${resource}?search=${encodeURIComponent(all.items[0].code)}&sortBy=invoiceCount&order=desc`);
  assert.ok(search.items.some((item) => item.id === all.items[0].id));
  console.log(`PASS: ${resource} fields, both sort directions, global pagination, all activity/balance combinations, search and invalid-query validation`);
}
await request("/purchase-invoices?status=PAID&limit=1");
console.log("PASS: existing purchase invoice status filtering remains available");
