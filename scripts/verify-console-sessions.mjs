import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const jar = new Map(), tenantIds = [];
async function request(path, scope, token, body, expected = 200, extra = {}) {
  const response = await fetch(`http://localhost:${scope === "platform" ? "8002" : "8000"}/api/v1${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(scope ? { "X-FII-Console": scope } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const header of response.headers.getSetCookie()) { const [pair] = header.split(";"); const offset = pair.indexOf("="); jar.set(pair.slice(0, offset), pair.slice(offset + 1)); }
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${data.error?.message ?? "unexpected response"}`);
  return data;
}
assert.ok(process.env.CONSOLE_TEST_SUPERADMIN_PASSWORD, "Set CONSOLE_TEST_SUPERADMIN_PASSWORD");
try {
  const platform = await request("/auth/login", "platform", null, { email: "superadmin@platform.local", password: process.env.CONSOLE_TEST_SUPERADMIN_PASSWORD });
  assert.ok(jar.get("fii_refresh_platform"));
  const stamp = Date.now();
  const tenantInput = (suffix) => ({ name: "Console Isolation Test", subdomain: `console-check-${stamp}-${suffix}`, adminName: "Console Tester", adminEmail: `console-${stamp}-${suffix}@example.test`, adminPassword: "Console!Verify2026#A", maxUsers: 2, maxCustomers: 2, trialDays: 1 });
  const input = tenantInput("a");
  const first = await request("/platform/tenants", "platform", platform.accessToken, input, 201); tenantIds.push(first.tenant.id);
  const tenant = await request("/auth/login", "tenant", null, { email: input.adminEmail, password: input.adminPassword });
  assert.ok(jar.get("fii_refresh_tenant"));
  // Legacy clients/portal share the host too: this must not replace either scoped cookie.
  await request("/auth/login", undefined, null, { email: input.adminEmail, password: input.adminPassword });
  assert.ok(jar.get("fii_refresh"));
  const p = await request("/auth/refresh", "platform", null, {}, 200, { "X-FII-User": platform.user.id });
  const pMe = await request("/auth/me", "platform", p.accessToken);
  assert.equal(pMe.id, platform.user.id); assert.ok(pMe.permissions.includes("platform:create"));
  const t = await request("/auth/refresh", "tenant", null, {}, 200, { "X-FII-User": tenant.user.id });
  assert.equal((await request("/auth/me", "tenant", t.accessToken)).id, tenant.user.id);
  await request("/auth/refresh", "tenant", null, {}, 401, { "X-FII-User": platform.user.id });
  await request("/auth/login", "platform", null, { email: input.adminEmail, password: input.adminPassword }, 403);
  await request("/platform/tenants", "tenant", t.accessToken, tenantInput("denied"), 403);
  await request("/auth/logout", "tenant", null, {});
  const final = await request("/auth/refresh", "platform", null, {}, 200, { "X-FII-User": platform.user.id });
  const second = await request("/platform/tenants", "platform", final.accessToken, tenantInput("b"), 201); tenantIds.push(second.tenant.id);
  console.log("PASS: simultaneous shared-host console cookies, legacy login isolation, account-pinned refresh, cross-console denial, independent logout, and tenant creation after refresh");
} finally {
  for (const tenantId of tenantIds) {
    const cleanup = `import {prisma} from '@fii/database'; const tenantId=${JSON.stringify(tenantId)};const t=await prisma.tenant.findUnique({where:{id:tenantId}});if(!t?.subdomain.startsWith('console-check-'))throw Error('Refusing non-test cleanup');const ids=(await prisma.user.findMany({where:{tenantId},select:{id:true}})).map(u=>u.id);await prisma.$transaction([prisma.auditLog.deleteMany({where:{tenantId}}),prisma.accountToken.deleteMany({where:{userId:{in:ids}}}),prisma.refreshToken.deleteMany({where:{userId:{in:ids}}}),prisma.userRole.deleteMany({where:{userId:{in:ids}}}),prisma.user.deleteMany({where:{tenantId}}),prisma.numberSeries.deleteMany({where:{tenantId}}),prisma.financialYear.deleteMany({where:{tenantId}}),prisma.tenantLicenseEvent.deleteMany({where:{tenantId}}),prisma.tenant.delete({where:{id:tenantId}})]);await prisma.$disconnect();console.log('Temporary console-test tenant removed');`;
    process.stdout.write(execFileSync("docker", ["exec", "-w", "/app/services/auth-service", "fii-billing-prod-auth-service-1", "node", "--input-type=module", "-e", cleanup], { encoding: "utf8" }));
  }
}
