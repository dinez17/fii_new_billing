import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@fii/database";
import { getCustomer, setPortalAccess } from "../src/services/customer.service.js";
import { portalAccessBody } from "../src/validators.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("chosen password when enabling customer portal access", () => {
  let tenantId = "", otherId = "", customerId = "";
  beforeAll(async () => {
    const suffix = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: "Portal setup", subdomain: `portal-setup-${suffix}` } })).id;
    otherId = (await prisma.tenant.create({ data: { name: "Other", subdomain: `portal-other-${suffix}` } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "P1", name: "Portal customer", email: "portal@example.test", portalEnabled: false } })).id;
  });
  afterAll(async () => { await prisma.user.deleteMany({ where: { tenantId } }); await prisma.customer.deleteMany({ where: { tenantId } }); await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } }); await prisma.$disconnect(); });
  it("requires a password on every enablement but not disablement", () => {
    expect(portalAccessBody.safeParse({ enable: true }).success).toBe(false);
    expect(portalAccessBody.safeParse({ enable: true, password: "short" }).success).toBe(false);
    expect(portalAccessBody.safeParse({ enable: true, password: "😀".repeat(30) }).success).toBe(false);
    expect(portalAccessBody.safeParse({ enable: false }).success).toBe(true);
  });
  it("creates only a customer login with the chosen hashed password", async () => {
    expect(await setPortalAccess(tenantId, customerId, true, "PortalInitial123!")).toEqual({ enabled: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { customerId } });
    expect(user.userType).toBe("CUSTOMER"); expect(user.email).toBe("portal@example.test"); expect(user.passwordHash).not.toBe("PortalInitial123!"); expect(await bcrypt.compare("PortalInitial123!", user.passwordHash)).toBe(true);
    expect((await getCustomer(tenantId, customerId)).portalEnabled).toBe(true);
  });
  it("disables atomically then re-enables with a new password and revokes old refresh sessions", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { customerId } });
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: `portal-${user.id}`, expiresAt: new Date(Date.now()+86_400_000) } });
    await setPortalAccess(tenantId, customerId, false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("INACTIVE");
    await expect(setPortalAccess(tenantId, customerId, true)).rejects.toThrow(/password/i);
    expect((await getCustomer(tenantId, customerId)).portalEnabled).toBe(false);
    await setPortalAccess(tenantId, customerId, true, "PortalReenabled456!");
    const changed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(changed.status).toBe("ACTIVE"); expect(await bcrypt.compare("PortalReenabled456!", changed.passwordHash)).toBe(true); expect(await bcrypt.compare("PortalInitial123!", changed.passwordHash)).toBe(false);
    expect(await prisma.user.count({ where: { customerId } })).toBe(1); expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });
  it("blocks cross-tenant access, missing emails and duplicate-account collisions without partial enablement", async () => {
    await expect(setPortalAccess(otherId, customerId, true, "CrossTenant123!")).rejects.toThrow(/not found/i);
    const missing = await prisma.customer.create({ data: { tenantId, code: "MISSING", name: "No primary email", portalEnabled: false } });
    await expect(setPortalAccess(tenantId, missing.id, true, "MissingEmail123!")).rejects.toThrow(/primary email/);
    const collision = await prisma.customer.create({ data: { tenantId, code: "COLLISION", name: "Collision", email: "staff@example.test", portalEnabled: false } });
    await prisma.user.create({ data: { tenantId, name: "Existing staff", email: collision.email!, passwordHash: "untouched", userType: "STAFF" } });
    await expect(setPortalAccess(tenantId, collision.id, true, "Collision123!")).rejects.toThrow(/already used/);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: collision.id } })).portalEnabled).toBe(false);
    expect(await prisma.user.count({ where: { customerId: collision.id } })).toBe(0);
    // A legacy true flag without any portal User must not be presented as enabled.
    await prisma.customer.update({ where: { id: missing.id }, data: { portalEnabled: true } });
    expect((await getCustomer(tenantId, missing.id)).portalEnabled).toBe(false);
  });
});
