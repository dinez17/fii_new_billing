import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const base = process.env.BULK_TEST_BASE_URL ?? "http://localhost:8000/api/v1";
async function request(path, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${data.error?.message ?? ""}`);
  return data;
}
function cleanup(id) {
  assert.match(id, /^[0-9a-f-]{36}$/);
  const code = `import {prisma} from '@fii/database';
    const tenantId=${JSON.stringify(id)};
    const t=await prisma.tenant.findUnique({where:{id:tenantId}});
    if(!t?.subdomain.startsWith('bulk-check-')) throw Error('Refusing to delete a non-test tenant');
    const users=await prisma.user.findMany({where:{tenantId},select:{id:true}});
    const userIds=users.map(u=>u.id);
    await prisma.$transaction([
      prisma.stockMovement.deleteMany({where:{tenantId}}),
      prisma.product.deleteMany({where:{tenantId}}),
      prisma.customer.deleteMany({where:{tenantId}}),
      prisma.plan.deleteMany({where:{tenantId}}),
      prisma.supplier.deleteMany({where:{tenantId}}),
      prisma.auditLog.deleteMany({where:{tenantId}}),
      prisma.refreshToken.deleteMany({where:{userId:{in:userIds}}}),
      prisma.userRole.deleteMany({where:{userId:{in:userIds}}}),
      prisma.user.deleteMany({where:{tenantId}}),
      prisma.numberSeries.deleteMany({where:{tenantId}}),
      prisma.financialYear.deleteMany({where:{tenantId}}),
      prisma.tenantLicenseEvent.deleteMany({where:{tenantId}}),
      prisma.tenant.delete({where:{id:tenantId}})
    ]); await prisma.$disconnect(); console.log('Temporary bulk-test tenant and records removed');`;
  process.stdout.write(execFileSync("docker", ["exec", "-w", "/app/services/auth-service", "fii-billing-prod-auth-service-1", "node", "--input-type=module", "-e", code], { encoding: "utf8" }));
}

if (process.argv[2] === "--cleanup") cleanup(process.argv[3]);
else {
  assert.ok(process.env.BULK_TEST_SUPERADMIN_PASSWORD, "Set BULK_TEST_SUPERADMIN_PASSWORD before running live verification");
  let tenantId;
  let keepFixture = false;
  try {
    const platform = await request("/auth/login", null, { email: "superadmin@platform.local", password: process.env.BULK_TEST_SUPERADMIN_PASSWORD });
    const subdomain = `bulk-check-${Date.now()}`;
    const email = `admin@${subdomain}.test`;
    const fixture = await request("/platform/tenants", platform.accessToken, { name: "Temporary Bulk Verification", subdomain, adminName: "Import Tester", adminEmail: email, adminPassword: "Bulk!Verify2026#A", trialDays: 1, maxUsers: 2, maxCustomers: 2 });
    tenantId = fixture.tenant.id;
    const session = await request("/auth/login", null, { email, password: "Bulk!Verify2026#A" });
    const token = session.accessToken;
    const before = await request("/products", token);
    const preview = await request("/products/import", token, { dryRun: true, rows: [{ sku: "PREVIEW", name: "Preview only", salePrice: "125" }, { sku: "BAD", name: "Invalid", gstRate: "99" }] });
    assert.deepEqual(preview.results.map(r => r.status), ["ready", "error"]);
    assert.equal((await request("/products", token)).total, before.total);
    console.log("PASS: dry-run validation performs no writes");

    const rows = Array.from({ length: 101 }, (_, i) => ({ sku: `BULK-${String(i).padStart(3, "0")}`, name: `Bulk Product ${String(i).padStart(3, "0")}`, purchasePrice: "10", salePrice: "25", gstRate: "18", openingStock: i === 0 ? "7" : "0", isService: false, tenantId: "must-not-be-used" }));
    for (let i = 0; i < rows.length; i += 100) {
      const imported = await request("/products/import", token, { dryRun: false, rows: rows.slice(i, i + 100) });
      assert.ok(imported.results.every(r => r.status === "created"));
    }
    const search = await request("/products?search=BULK-100&limit=50", token);
    assert.equal(search.items.length, 1);
    assert.equal(search.items[0].tenantId, tenantId);
    const first = await request("/products?search=BULK-000", token);
    assert.equal(Number(first.items[0].stockQty), 7);
    const duplicate = await request("/products/import", token, { dryRun: false, rows: [rows[0]] });
    assert.equal(duplicate.results[0].status, "error");
    assert.equal(Number((await request(`/products/${first.items[0].id}`, token)).stockQty), 7);
    console.log("PASS: bulk products, search beyond 100, tenant stamping, duplicate protection and opening stock");

    const customers = await request("/customers/import", token, { dryRun: false, rows: [
      { name: "First Customer", phone: "9000000001", stateCode: "03", openingBalance: "50" },
      { name: "Second Customer", phone: "9000000002" },
      { name: "Over Limit", phone: "9000000003" },
    ] });
    assert.deepEqual(customers.results.map(r => r.status), ["created", "created", "error"]);
    assert.match(customers.results[2].message, /license limit/);
    const customer = await request(`/customers/${customers.results[0].id}`, token);
    assert.equal(customer.stateCode, "03"); assert.equal(Number(customer.openingBalance), 50);
    console.log("PASS: customer import preserves identifiers/balances and enforces license limits");

    const plans = await request("/plans/import", token, { dryRun: false, rows: [{ name: "Fiber 100", code: "FIB100", price: "599" }, { name: "Duplicate", code: "fib100", price: "599" }, { name: "Invalid", code: "BAD", price: "-1" }] });
    assert.deepEqual(plans.results.map(r => r.status), ["created", "error", "error"]);
    const supplier = await request("/suppliers", token, { name: "Bulk Test Supplier", phone: "9000000011", stateCode: "33" });
    assert.equal((await request(`/suppliers/${supplier.id}`, token)).name, "Bulk Test Supplier");
    const cross = await fetch(base + `/products/${search.items[0].id}`, { headers: { authorization: `Bearer ${platform.accessToken}` } });
    assert.equal(cross.status, 404);
    console.log("PASS: plan validation, supplier selection hydration and cross-tenant read isolation");
    keepFixture = process.env.BULK_TEST_KEEP_FIXTURE === "true";
    if (keepFixture) console.log(JSON.stringify({ tenantId, email, subdomain, productId: search.items[0].id, customerId: customer.id, supplierId: supplier.id }));
  } finally {
    if (tenantId && !keepFixture) cleanup(tenantId);
  }
}
