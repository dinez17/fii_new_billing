import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, forTenant } from "../src/index.js";

// Integration tests are opt-in so a developer's normal DATABASE_URL can never
// accidentally be modified by the unit-test command.
const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

d("tenant isolation (integration)", () => {
  const stamp = Date.now();
  let tA = "", tB = "";

  beforeAll(async () => {
    const a = await prisma.tenant.create({ data: { name: `ISO-A-${stamp}`, subdomain: `iso-a-${stamp}` } });
    const b = await prisma.tenant.create({ data: { name: `ISO-B-${stamp}`, subdomain: `iso-b-${stamp}` } });
    tA = a.id; tB = b.id;
    await forTenant(prisma, tA).customer.create({ data: { code: "C-A", name: "Alpha", phone: `90${stamp}`.slice(0, 12) } });
    await forTenant(prisma, tB).customer.create({ data: { code: "C-B", name: "Beta", phone: `91${stamp}`.slice(0, 12) } });
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
    await prisma.$disconnect();
  });

  it("scopes findMany to the caller's tenant", async () => {
    const rows = await forTenant(prisma, tA).customer.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((c) => c.tenantId === tA)).toBe(true);
    expect(rows.some((c) => c.name === "Beta")).toBe(false);
  });

  it("auto-stamps tenantId on create", async () => {
    const c = await forTenant(prisma, tA).customer.findFirst({ where: { code: "C-A" } });
    expect(c?.tenantId).toBe(tA);
  });

  it("cannot read another tenant's row by primary key", async () => {
    const beta = await prisma.customer.findFirst({ where: { tenantId: tB } });
    const leaked = await forTenant(prisma, tA).customer.findUnique({ where: { id: beta!.id } });
    expect(leaked).toBeNull();
  });

  it("cannot update another tenant's row", async () => {
    const beta = await prisma.customer.findFirst({ where: { tenantId: tB } });
    await forTenant(prisma, tA).customer.updateMany({ where: { id: beta!.id }, data: { name: "HACKED" } });
    const after = await prisma.customer.findUnique({ where: { id: beta!.id } });
    expect(after?.name).toBe("Beta");
  });
});
