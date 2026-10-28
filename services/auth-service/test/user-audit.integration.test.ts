import bcrypt from "bcryptjs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { updateUser } from "../src/services/user.service.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("tenant user edits never audit password values", () => {
  let tenantId = "", userId = "";
  beforeEach(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Audit test", subdomain: `audit-user-${Date.now()}` } })).id;
    userId = (await prisma.user.create({ data: { tenantId, name: "Before", email: "audit@example.test", passwordHash: await bcrypt.hash("BeforeOnly123!", 4) } })).id;
  });
  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
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
