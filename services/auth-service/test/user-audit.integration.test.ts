import bcrypt from "bcryptjs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { deleteUser, resetUserPassword, updateUser } from "../src/services/user.service.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("tenant user edits never audit password values", () => {
  let tenantId = "", userId = "";
  beforeEach(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Audit test", subdomain: `audit-user-${Date.now()}` } })).id;
    userId = (await prisma.user.create({ data: { tenantId, name: "Before", email: "audit@example.test", passwordHash: await bcrypt.hash("BeforeOnly123!", 4) } })).id;
  });
  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } });
    await prisma.accountToken.deleteMany({ where: { user: { tenantId } } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });
  async function staff() {
    return prisma.user.create({ data: { tenantId, name: "Staff", email: "staff@example.test", passwordHash: "test-only" } });
  }
  it("updates the display name and login email and prevents duplicate emails", async () => {
    const user = await staff();
    await updateUser(tenantId, userId, user.id, { name: "Renamed", email: "new@example.test" });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({ name: "Renamed", email: "new@example.test" });
    await expect(updateUser(tenantId, userId, user.id, { email: "audit@example.test" })).rejects.toThrow("Email already in use");
  });
  it("revokes refresh sessions on deactivation and password reset does not reactivate", async () => {
    const user = await staff();
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: `test-${user.id}`, expiresAt: new Date(Date.now() + 60000) } });
    await updateUser(tenantId, userId, user.id, { status: "INACTIVE" });
    expect((await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } })).revokedAt).not.toBeNull();
    await resetUserPassword(tenantId, userId, user.id, "ResetOnlyTest123!");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("INACTIVE");
  });
  it("deletes the account and sessions while preserving historical audit events", async () => {
    const user = await staff();
    const log = await prisma.auditLog.create({ data: { tenantId, userId: user.id, action: "HISTORICAL_TEST" } });
    await deleteUser(tenantId, userId, user.id);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: log.id } })).toMatchObject({ action: "HISTORICAL_TEST", userId: null });
    expect(await prisma.auditLog.findFirst({ where: { tenantId, action: "USER_DELETE", entityId: user.id } })).not.toBeNull();
  });
  it("rejects self deletion/deactivation and cross-tenant edits/deletes", async () => {
    await expect(deleteUser(tenantId, userId, userId)).rejects.toThrow("own account");
    await expect(updateUser(tenantId, userId, userId, { status: "INACTIVE" })).rejects.toThrow("own account");
    await expect(updateUser("another-tenant", userId, userId, { name: "Wrong" })).rejects.toThrow();
    await expect(deleteUser("another-tenant", "another-actor", userId)).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { id: userId } })).toMatchObject({ status: "ACTIVE", name: "Before" });
  });
  it("changes the saved password while recording only a password-change flag", async () => {
    const newPassword = "RegressionOnlyNew123!";
    await updateUser(tenantId, userId, userId, { name: "After", password: newPassword });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare(newPassword, user.passwordHash)).toBe(true);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "USER_UPDATE" } });
    expect(log.after).toMatchObject({ name: "After", passwordChanged: true });
    expect(JSON.stringify(log.after)).not.toContain(newPassword);
    expect(log.after).not.toHaveProperty("password");
    expect(log.after).not.toHaveProperty("passwordHash");
  });
});
