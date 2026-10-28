import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma, syncCustomerCodePrefix, allocateNumber } from "../src/index.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("saved customer code prefix", () => {
  let tenantId = "";
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Code prefix", subdomain: `prefix-${Date.now()}` } })).id;
    await prisma.numberSeries.create({ data: { tenantId, docType: "CUSTOMER", fyCode: "PERM", prefix: "FII.", padding: 5, nextNumber: 1 } });
    await prisma.customer.createMany({ data: [
      { tenantId, code: "FII.00001", name: "Existing code" },
      { tenantId, code: "LISOFT-C-42", name: "Legacy code" },
      { tenantId, code: "FIIX00002", name: "Regex punctuation is literal" },
    ] });
  });
  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.numberSeries.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });
  it("previews without changes, preserves valid codes, avoids collisions, and keeps allocation safe", async () => {
    const before = await prisma.customer.findMany({ where: { tenantId } });
    const preview = await prisma.$transaction((tx) => syncCustomerCodePrefix(tx, tenantId));
    expect(preview.changes).toHaveLength(2);
    expect((await prisma.customer.findMany({ where: { tenantId } })).map((row) => row.code).sort()).toEqual(before.map((row) => row.code).sort());
    const result = await prisma.$transaction((tx) => syncCustomerCodePrefix(tx, tenantId, true));
    expect(result.changes.map((row) => row.newCode).sort()).toEqual(["FII.00002", "FII.00003"]);
    expect((await prisma.customer.findMany({ where: { tenantId } })).map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    expect((await prisma.$transaction((tx) => syncCustomerCodePrefix(tx, tenantId, true))).changes).toEqual([]);
    expect(await prisma.$transaction((tx) => allocateNumber(tx, tenantId, "CUSTOMER"))).toBe("FII.00004");
  });
});
