import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = "http://localhost:8002/api/v1";
async function request(path, token, body, method = body ? "POST" : "GET", expected = 200) {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${data.error?.message ?? "unexpected response"}`);
  const refresh = /(?:^|,\s*)fii_refresh=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  if (refresh) data.refreshToken = decodeURIComponent(refresh[1]);
  return data;
}
assert.ok(process.env.ADMIN_TEST_SUPERADMIN_PASSWORD, "Set ADMIN_TEST_SUPERADMIN_PASSWORD");
let tenantId;
try {
  const platform = await request("/auth/login", null, { email: "superadmin@platform.local", password: process.env.ADMIN_TEST_SUPERADMIN_PASSWORD });
  const stamp = Date.now(), email = `owner-${stamp}@example.test`, password = "Admin!Verify2026#A";
  const fixture = await request("/platform/tenants", platform.accessToken, { name: "Admin Account Verification", subdomain: `admin-check-${stamp}`, adminName: "Initial Admin", adminEmail: email, adminPassword: password, maxUsers: 3, maxCustomers: 2, trialDays: 1 }, "POST", 201);
  tenantId = fixture.tenant.id;
  const root = `/platform/tenants/${tenantId}/admins`;
  const initial = await request("/auth/login", null, { email, password });
  await request(root, initial.accessToken, undefined, "GET", 403);
  await request(root, null, undefined, "GET", 401);
  const extra = await request(root, platform.accessToken, { name: "Extra Admin", email: `extra-${stamp}@example.test`, password }, "POST", 201);
  assert.ok(!JSON.stringify(extra).includes("password"));
  await request(root, platform.accessToken, { name: "Duplicate", email: extra.email, password }, "POST", 409);
  await request(root, platform.accessToken, { name: "Short Password", email: `short-${stamp}@example.test`, password: "short" }, "POST", 400);
  const session = await request("/auth/login", null, { email: extra.email, password });
  assert.ok(session.refreshToken, "Login must issue a refresh cookie");
  await request(root, initial.accessToken, { name: "Denied Admin", email: "denied@example.test", password }, "POST", 403);
  await request(`${root}/${extra.id}/reset-password`, initial.accessToken, { password }, "POST", 403);
  await request(`${root}/${extra.id}`, platform.accessToken, { name: "Duplicate Login", email }, "PUT", 409);
  await request(`${root}/${platform.user.id}`, platform.accessToken, { name: "Must not update", email: "blocked@example.test" }, "PUT", 404);
  const renamed = `renamed-${stamp}@example.test`;
  await request(`${root}/${extra.id}`, platform.accessToken, { name: "Renamed Admin", email: renamed }, "PUT");
  await request("/auth/login", null, { email: extra.email, password }, "POST", 401);
  await request("/auth/refresh", null, { refreshToken: session.refreshToken }, "POST", 401);
  const renamedSession = await request("/auth/login", null, { email: renamed, password });
  const reset = "Admin!NewPassword2026#B";
  await request(`${root}/${extra.id}/reset-password`, platform.accessToken, { password: reset });
  await request("/auth/login", null, { email: renamed, password }, "POST", 401);
  await request("/auth/refresh", null, { refreshToken: renamedSession.refreshToken }, "POST", 401);
  const fresh = await request("/auth/login", null, { email: renamed, password: reset });
  assert.equal(fresh.user.email, renamed);
  const admins = await request(root, platform.accessToken);
  assert.equal(admins.length, 2); assert.ok(admins.some((item) => item.email === renamed));
  console.log("PASS: create admin, duplicate/validation checks, edit login, reset password, login and refresh revocation, staff denial and tenant boundary");
} finally {
  if (tenantId) {
    const cleanup = `import {prisma} from '@fii/database'; const tenantId=${JSON.stringify(tenantId)};
      const t=await prisma.tenant.findUnique({where:{id:tenantId}}); if(!t?.subdomain.startsWith('admin-check-')) throw Error('Refusing non-test cleanup');
      const ids=(await prisma.user.findMany({where:{tenantId},select:{id:true}})).map(u=>u.id);
      await prisma.$transaction([prisma.auditLog.deleteMany({where:{tenantId}}),prisma.accountToken.deleteMany({where:{userId:{in:ids}}}),prisma.refreshToken.deleteMany({where:{userId:{in:ids}}}),prisma.userRole.deleteMany({where:{userId:{in:ids}}}),prisma.user.deleteMany({where:{tenantId}}),prisma.numberSeries.deleteMany({where:{tenantId}}),prisma.financialYear.deleteMany({where:{tenantId}}),prisma.tenantLicenseEvent.deleteMany({where:{tenantId}}),prisma.tenant.delete({where:{id:tenantId}})]);await prisma.$disconnect();console.log('Temporary admin verification tenant removed');`;
    process.stdout.write(execFileSync("docker", ["exec", "-w", "/app/services/auth-service", "fii-billing-prod-auth-service-1", "node", "--input-type=module", "-e", cleanup], { encoding: "utf8" }));
  }
}
