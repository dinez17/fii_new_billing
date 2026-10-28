import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const base = "http://localhost:8000/api/v1";
async function request(path, token, body, method = body ? "POST" : "GET", expected = 200) {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${data.error?.message ?? "unexpected response"}`);
  return data;
}
assert.ok(process.env.STOCK_TEST_SUPERADMIN_PASSWORD, "Set STOCK_TEST_SUPERADMIN_PASSWORD");
let tenantId;
try {
  const platform = await request("/auth/login", null, { email: "superadmin@platform.local", password: process.env.STOCK_TEST_SUPERADMIN_PASSWORD });
  const subdomain = `stock-check-${Date.now()}`;
  const email = `admin@${subdomain}.test`;
  const fixture = await request("/platform/tenants", platform.accessToken, { name: "Temporary Stock Verification", subdomain, adminName: "Stock Tester", adminEmail: email, adminPassword: "Stock!Verify2026#A", trialDays: 1, maxUsers: 2, maxCustomers: 2 }, "POST", 201);
  tenantId = fixture.tenant.id;
  const session = await request("/auth/login", null, { email, password: "Stock!Verify2026#A" });
  const token = session.accessToken;
  await request("/settings/company", token, { name: "Temporary Stock Verification", stateCode: "33" }, "PUT");
  const product = await request("/products", token, { sku: "STOCK-CHECK", name: "Stock policy test", salePrice: 100 }, "POST", 201);
  const customer = await request("/customers", token, { name: "Stock Test Customer", phone: "9000000001", stateCode: "33" }, "POST", 201);
  const invoice = { customerId: customer.id, invoiceDate: new Date().toISOString(), dueDate: new Date(Date.now() + 86_400_000).toISOString(), items: [{ productId: product.id, description: product.name, quantity: 1, unitPrice: 100, discount: 0, gstRate: 18 }] };
  const blocked = await request("/invoices", token, invoice, "POST", 409);
  assert.equal(blocked.error.code, "INSUFFICIENT_STOCK");
  assert.match(blocked.error.message, /available 0, required 1/);
  assert.equal((await request("/invoices", token)).total, 0);
  console.log("PASS: invoice blocked with clear HTTP 409 stock message and no saved invoice");
  await request("/settings/group/INVENTORY", token, { allowNegativeStock: "true" }, "PUT");
  const out = await request("/stock-adjustments", token, { productId: product.id, direction: "OUT", quantity: 2, reason: "Temporary policy test" });
  assert.equal(out.balanceAfter, -2);
  await request("/settings/group/INVENTORY", token, { allowNegativeStock: "false" }, "PUT");
  const blockedAdjustment = await request("/stock-adjustments", token, { productId: product.id, direction: "OUT", quantity: 1, reason: "Temporary disabled test" }, "POST", 409);
  assert.equal(blockedAdjustment.error.code, "INSUFFICIENT_STOCK");
  const incoming = await request("/stock-adjustments", token, { productId: product.id, direction: "IN", quantity: 1, reason: "Temporary replenishment test" });
  assert.equal(incoming.balanceAfter, -1);
  await request("/settings/group/INVENTORY", token, { allowNegativeStock: "yes" }, "PUT", 400);
  assert.equal((await request("/settings/group/INVENTORY", token)).allowNegativeStock, "false");
  console.log("PASS: enabled allows negative stock, disabled rejects it, replenishment works, invalid setting is rejected");
} finally {
  if (tenantId) {
    assert.match(tenantId, /^[0-9a-f-]{36}$/);
    const code = `import {prisma} from '@fii/database';
      const tenantId=${JSON.stringify(tenantId)};
      const t=await prisma.tenant.findUnique({where:{id:tenantId}});
      if(!t?.subdomain.startsWith('stock-check-')) throw Error('Refusing to remove a non-test tenant');
      const invoices=await prisma.invoice.findMany({where:{tenantId},select:{id:true}});
      const users=await prisma.user.findMany({where:{tenantId},select:{id:true}});
      const userIds=users.map(u=>u.id);
      await prisma.$transaction([
        prisma.invoiceItem.deleteMany({where:{invoiceId:{in:invoices.map(i=>i.id)}}}),
        prisma.ledgerEntry.deleteMany({where:{tenantId}}),
        prisma.invoice.deleteMany({where:{tenantId}}),
        prisma.outboxEvent.deleteMany({where:{tenantId}}),
        prisma.stockMovement.deleteMany({where:{tenantId}}),
        prisma.product.deleteMany({where:{tenantId}}),
        prisma.customer.deleteMany({where:{tenantId}}),
        prisma.setting.deleteMany({where:{tenantId}}),
        prisma.auditLog.deleteMany({where:{tenantId}}),
        prisma.refreshToken.deleteMany({where:{userId:{in:userIds}}}),
        prisma.userRole.deleteMany({where:{userId:{in:userIds}}}),
        prisma.user.deleteMany({where:{tenantId}}),
        prisma.numberSeries.deleteMany({where:{tenantId}}),
        prisma.financialYear.deleteMany({where:{tenantId}}),
        prisma.tenantLicenseEvent.deleteMany({where:{tenantId}}),
        prisma.tenant.delete({where:{id:tenantId}})
      ]); await prisma.$disconnect(); console.log('Temporary stock verification tenant removed');`;
    process.stdout.write(execFileSync("docker", ["exec", "-w", "/app/services/auth-service", "fii-billing-prod-auth-service-1", "node", "--input-type=module", "-e", code], { encoding: "utf8" }));
  }
}
