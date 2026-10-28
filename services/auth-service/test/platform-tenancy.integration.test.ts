import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { createTenant, suspendTenant, updateLicense, updateTenant, createTenantAdmin, listTenantAdmins, updateTenantAdmin } from "../src/services/platform.service.js";
import { createUser } from "../src/services/user.service.js";
import { createRole } from "../src/services/role.service.js";

const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

d("platform tenant lifecycle (integration)", () => {
  const stamp = Date.now();
  const subdomain = `platform-it-${stamp}`;
  let actorId = "";
  let tenantId = "";
  let adminRoleId = "";

  beforeAll(async () => {
    const actor = await prisma.user.findFirstOrThrow({
      where: { email: "superadmin@platform.local", tenant: { subdomain: "platform" } },
    });
    actorId = actor.id;
    adminRoleId = (await prisma.role.findFirstOrThrow({ where: { tenantId: null, code: "ADMIN" } })).id;
  });

  afterAll(async () => {
    if (tenantId) {
      const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true } });
      const userIds = users.map((user) => user.id);
      await prisma.$transaction([
        prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.accountToken.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.auditLog.deleteMany({ where: { tenantId } }),
        prisma.tenantLicenseEvent.deleteMany({ where: { tenantId } }),
        prisma.numberSeries.deleteMany({ where: { tenantId } }),
        prisma.financialYear.deleteMany({ where: { tenantId } }),
        prisma.user.deleteMany({ where: { tenantId } }),
      ]);
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it("provisions a tenant, admin, financial year, and operational number series", async () => {
    const result = await createTenant(actorId, {
      name: `Platform Integration ${stamp}`,
      subdomain,
      adminName: "Tenant Admin",
      adminEmail: `admin-${stamp}@example.test`,
      adminPassword: "Tenant!Password#2026",
      trialDays: 14,
      maxUsers: 1,
      maxCustomers: 2,
    });
    tenantId = result.tenant.id;

    expect(result.tenant.licenseStatus).toBe("TRIAL");
    expect(await prisma.user.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.financialYear.count({ where: { tenantId, isActive: true } })).toBe(1);
    const series = await prisma.numberSeries.findMany({ where: { tenantId }, select: { docType: true } });
    expect(series.map((item) => item.docType)).toEqual(expect.arrayContaining(["CUSTOMER", "SUBSCRIBER", "INVOICE"]));
  });

  it("renames a tenant subdomain and rejects duplicates", async () => {
    const renamed = `${subdomain}-new`;
    const updated = await updateTenant(tenantId, { subdomain: renamed });
    expect(updated.subdomain).toBe(renamed);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).subdomain).toBe(renamed);
    await expect(updateTenant(tenantId, { subdomain: "platform" })).rejects.toThrow("Subdomain already exists");
    await updateTenant(tenantId, { subdomain });
  });

  it("issues a one-time license key and stores only its hash", async () => {
    const result = await updateLicense(actorId, tenantId, {
      planCode: "BUSINESS",
      status: "ACTIVE",
      startsAt: new Date(),
      endsAt: new Date("2030-12-31T00:00:00.000Z"),
      maxUsers: 1,
      maxCustomers: 2,
      notes: "integration test",
    });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(result.licenseKey).toMatch(/^fii_/);
    expect(tenant.licenseKeyHash).toBe(createHash("sha256").update(result.licenseKey).digest("hex"));
    expect(tenant.licenseKeyHash).not.toContain(result.licenseKey);
  });

  it("enforces the licensed user limit", async () => {
    await expect(createUser(tenantId, actorId, {
      name: "Over Limit",
      email: `over-limit-${stamp}@example.test`,
      password: "Tenant!Password#2026",
      roleIds: [adminRoleId],
    })).rejects.toThrow("User license limit reached (1)");
  });

  it("blocks platform permissions in tenant-defined roles", async () => {
    const platformPermission = await prisma.permission.findFirstOrThrow({ where: { module: "platform" } });
    await expect(createRole(tenantId, actorId, {
      code: `NO_PLATFORM_${stamp}`,
      name: "No Platform Escalation",
      permissionIds: [platformPermission.id],
    })).rejects.toThrow("Platform permissions cannot be assigned");
  });

  it("creates only tenant admins, enforces license limits and hides secrets", async () => {
    await expect(createTenantAdmin(actorId, tenantId, { name: "Extra Admin", email: `extra-${stamp}@example.test`, password: "Extra!Password#2026" })).rejects.toThrow("User license limit reached (1)");
    await prisma.tenant.update({ where: { id: tenantId }, data: { maxUsers: 3 } });
    const admin = await createTenantAdmin(actorId, tenantId, { name: "Extra Admin", email: `extra-${stamp}@example.test`, password: "Extra!Password#2026" });
    expect(admin).not.toHaveProperty("passwordHash");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, include: { roles: { include: { role: true } } } });
    expect(await bcrypt.compare("Extra!Password#2026", stored.passwordHash)).toBe(true);
    expect(stored.roles.map((item) => item.role.code)).toEqual(["ADMIN"]);
    await expect(createTenantAdmin(actorId, tenantId, { name: "Duplicate", email: admin.email, password: "Extra!Password#2026" })).rejects.toThrow("Email already in use");
    expect(await listTenantAdmins(tenantId)).toHaveLength(2);
  });

  it("edits the login, resets passwords and revokes refresh and recovery tokens without logging passwords", async () => {
    const admins = await listTenantAdmins(tenantId);
    const admin = admins.find((item) => item.email.startsWith("extra-"))!;
    await prisma.refreshToken.create({ data: { userId: admin.id, tokenHash: `admin-refresh-${stamp}`, expiresAt: new Date(Date.now() + 60000) } });
    await prisma.accountToken.create({ data: { userId: admin.id, type: "PASSWORD_RESET", tokenHash: `admin-recovery-${stamp}`, expiresAt: new Date(Date.now() + 60000) } });
    await updateTenantAdmin(actorId, tenantId, admin.id, { name: "Renamed Admin", email: `renamed-${stamp}@example.test` });
    expect((await prisma.refreshToken.findFirstOrThrow({ where: { userId: admin.id } })).revokedAt).not.toBeNull();
    expect(await prisma.accountToken.count({ where: { userId: admin.id } })).toBe(0);
    await prisma.user.update({ where: { id: admin.id }, data: { status: "LOCKED", failedLogins: 5, lockoutUntil: new Date(Date.now() + 60000), mfaEnabled: true } });
    await updateTenantAdmin(actorId, tenantId, admin.id, { password: "Reset!Password#2026" });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored).toMatchObject({ status: "ACTIVE", failedLogins: 0, lockoutUntil: null, mfaEnabled: true });
    expect(await bcrypt.compare("Reset!Password#2026", stored.passwordHash)).toBe(true);
    expect(await bcrypt.compare("Extra!Password#2026", stored.passwordHash)).toBe(false);
    const logs = JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId, entityId: admin.id } }));
    expect(logs).not.toContain("Password#2026"); expect(logs).not.toContain(stored.passwordHash);
    await expect(updateTenantAdmin(actorId, tenantId, actorId, { password: "Forbidden!Reset2026" })).rejects.toThrow("Tenant admin not found");
    const platformTenant = await prisma.tenant.findUniqueOrThrow({ where: { subdomain: "platform" } });
    await expect(listTenantAdmins(platformTenant.id)).rejects.toThrow("Tenant not found");
  });

  it("suspends the tenant and records the license event", async () => {
    await suspendTenant(actorId, tenantId, "integration test suspension");
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant).toMatchObject({ isActive: false, licenseStatus: "SUSPENDED", suspensionReason: "integration test suspension" });
    expect(await prisma.tenantLicenseEvent.count({ where: { tenantId, action: "TENANT_SUSPENDED" } })).toBe(1);
  });
});
