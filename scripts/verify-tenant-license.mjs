import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
async function cleanup(tenantId) {
  const code = `import {prisma} from '@fii/database'; const tenantId=${JSON.stringify(tenantId)};
    const t=await prisma.tenant.findUnique({where:{id:tenantId}});if(!t?.subdomain.startsWith('license-check-')) throw Error('Refusing non-test cleanup');
    const ids=(await prisma.user.findMany({where:{tenantId},select:{id:true}})).map(u=>u.id);
    await prisma.$transaction([prisma.auditLog.deleteMany({where:{tenantId}}),prisma.accountToken.deleteMany({where:{userId:{in:ids}}}),prisma.refreshToken.deleteMany({where:{userId:{in:ids}}}),prisma.userRole.deleteMany({where:{userId:{in:ids}}}),prisma.user.deleteMany({where:{tenantId}}),prisma.numberSeries.deleteMany({where:{tenantId}}),prisma.financialYear.deleteMany({where:{tenantId}}),prisma.tenantLicenseEvent.deleteMany({where:{tenantId}}),prisma.tenant.delete({where:{id:tenantId}})]);await prisma.$disconnect();console.log('Temporary license verification tenant removed');`;
  process.stdout.write(execFileSync("docker", ["exec", "-w", "/app/services/settings-service", "fii-billing-prod-settings-service-1", "node", "--input-type=module", "-e", code], { encoding: "utf8" }));
}
if (process.env.LICENSE_TEST_CLEANUP_TENANT) { await cleanup(process.env.LICENSE_TEST_CLEANUP_TENANT); process.exit(0); }
assert.ok(process.env.LICENSE_TEST_SUPERADMIN_PASSWORD, "Set LICENSE_TEST_SUPERADMIN_PASSWORD");
async function request(path, token, body, method = body ? "POST" : "GET", expected = 200) {
  const response = await fetch(`http://localhost:8000/api/v1${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${data.error?.message ?? "unexpected response"}`);
  if (path.startsWith("/settings/license") && expected === 200) assert.equal(response.headers.get("cache-control"), "no-store");
  return data;
}
let tenantId, keep = false;
try {
  const platform = await request("/auth/login", null, { email: "superadmin@platform.local", password: process.env.LICENSE_TEST_SUPERADMIN_PASSWORD });
  const stamp = Date.now(), email = `admin@license-check-${stamp}.test`;
  const fixture = await request("/platform/tenants", platform.accessToken, { name: "License Preview Company", subdomain: `license-check-${stamp}`, adminName: "License Tester", adminEmail: email, adminPassword: "License!Verify2026#A", trialDays: 14, maxUsers: 5, maxCustomers: 100 }, "POST", 201);
  tenantId = fixture.tenant.id;
  const session = await request("/auth/login", null, { email, password: "License!Verify2026#A" });
  const trial = await request("/settings/license", session.accessToken);
  assert.equal(trial.effectiveStatus, "TRIAL"); assert.equal(trial.maxUsers, 5); assert.equal(trial.maxCustomers, 100);
  assert.deepEqual(trial.usage, { users: 1, customers: 0 }); assert.equal(trial.validUntil, trial.trialEndsAt);
  assert.ok(!Object.keys(trial).some((key) => /key|hash|secret/i.test(key)));
  await request("/settings/license", null, undefined, "GET", 401);
  await request(`/platform/tenants/${tenantId}/license`, platform.accessToken, { planCode: "BUSINESS", status: "ACTIVE", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 30 * 86400000).toISOString(), maxUsers: 10, maxCustomers: 1000 });
  const active = await request(`/settings/license?tenantId=${platform.user.id}`, session.accessToken);
  assert.equal(active.name, "License Preview Company"); assert.equal(active.planCode, "BUSINESS"); assert.equal(active.effectiveStatus, "ACTIVE"); assert.equal(active.daysRemaining, 30);
  console.log("PASS: live trial/active license details, usage counts, authentication, tenant scope and no private license fields");
  keep = process.env.LICENSE_TEST_KEEP_FIXTURE === "true";
  if (keep) console.log(JSON.stringify({ tenantId, email }));
} finally { if (tenantId && !keep) await cleanup(tenantId); }
