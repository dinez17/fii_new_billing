import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@fii/database";
import { assertActiveFy } from "../src/services/fy.js";

// Integration tests are deliberately opt-in; DATABASE_URL alone is not enough
// because it may point at a developer or production-like database.
const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

d("FY-lock enforcement (integration)", () => {
  const stamp = Date.now();
  let tenantId = "";
  const inRange = new Date("2026-06-01");

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { name: `FY-${stamp}`, subdomain: `fy-${stamp}` } });
    tenantId = t.id;
    await prisma.financialYear.create({
      data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isActive: true, isLocked: false },
    });
  });

  afterAll(async () => {
    await prisma.financialYear.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("passes for a date inside an unlocked active FY", async () => {
    await expect(assertActiveFy(tenantId, inRange)).resolves.toMatchObject({ code: "2026-27" });
  });

  it("rejects a date outside the FY", async () => {
    await expect(assertActiveFy(tenantId, new Date("2025-01-01"))).rejects.toThrow();
  });

  it("rejects posting into a locked FY", async () => {
    await prisma.financialYear.updateMany({ where: { tenantId }, data: { isLocked: true } });
    await expect(assertActiveFy(tenantId, inRange)).rejects.toThrow(/locked/i);
  });
});
