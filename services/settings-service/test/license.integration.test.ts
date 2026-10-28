import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { getTenantLicense } from "../src/license.service.js";
const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
d("tenant license isolation", () => {
  const ids: string[] = [];
  afterAll(async () => { await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } }); await prisma.tenant.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); });
  it("returns only the requested tenant's plan and counts, without license hashes or secrets", async () => {
    const stamp = Date.now();
    const first = await prisma.tenant.create({ data: { name: "License A", subdomain: `license-a-${stamp}`, planCode: "BASIC", maxUsers: 5, maxCustomers: 20, licenseKeyHash: "private-license-hash" } }); ids.push(first.id);
    const second = await prisma.tenant.create({ data: { name: "License B", subdomain: `license-b-${stamp}`, planCode: "ENTERPRISE", maxUsers: 50, maxCustomers: 200 } }); ids.push(second.id);
    await prisma.customer.create({ data: { tenantId: first.id, code: "C1", name: "Sample", phone: "9000000001" } });
    expect(await getTenantLicense(first.id)).toMatchObject({ planCode: "BASIC", maxUsers: 5, maxCustomers: 20, usage: { users: 0, customers: 1 } });
    const other = await getTenantLicense(second.id);
    expect(other).toMatchObject({ planCode: "ENTERPRISE", usage: { users: 0, customers: 0 } });
    expect(await getTenantLicense(first.id)).not.toHaveProperty("licenseKeyHash");
    await expect(getTenantLicense("missing-tenant")).rejects.toThrow("Tenant not found");
  });
});
