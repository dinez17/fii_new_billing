import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, rankParties } from "../src/index.js";

const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("party list filtering and global ranking", () => {
  let tenantId = "", foreignId = "";
  const customerIds: string[] = [], supplierIds: string[] = [];
  beforeAll(async () => {
    const stamp = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: "Party ranking", subdomain: `rank-${stamp}` } })).id;
    foreignId = (await prisma.tenant.create({ data: { name: "Foreign ranking", subdomain: `rank-other-${stamp}` } })).id;
    for (const [index, name] of ["Alpha", "Beta", "Gamma_%"].entries()) {
      customerIds.push((await prisma.customer.create({ data: { tenantId, code: `C-${index}`, name, openingBalance: ["0", "500.10", "-1.20"][index], isActive: index !== 1 } })).id);
      supplierIds.push((await prisma.supplier.create({ data: { tenantId, code: `S-${index}`, name, openingBalance: ["0", "500.10", "-1.20"][index], isActive: index !== 1 } })).id);
    }
    await prisma.customer.create({ data: { tenantId: foreignId, code: "FOREIGN", name: "Alpha", openingBalance: "999999" } });
    await prisma.supplier.create({ data: { tenantId: foreignId, code: "FOREIGN", name: "Alpha", openingBalance: "999999" } });
    for (const [type, ids] of [["CUSTOMER", customerIds], ["SUPPLIER", supplierIds]] as const) {
      await prisma.ledgerEntry.createMany({ data: [
        { tenantId, partyType: type, partyId: ids[1], fyCode: "2026-27", entryDate: new Date(), entryType: "INVOICE", refType: "TEST", refId: ids[1], debit: "20.05", credit: "10.02" },
        { tenantId: foreignId, partyType: type, partyId: ids[1], fyCode: "2026-27", entryDate: new Date(), entryType: "INVOICE", refType: "TEST", refId: ids[1], debit: "500000", credit: "0" },
      ] });
    }
    const base = { tenantId, fyCode: "2026-27", invoiceDate: new Date(), subTotal: "1", taxableValue: "1", grandTotal: "1" };
    for (const i of [0, 1]) {
      await prisma.invoice.create({ data: { ...base, customerId: customerIds[1], invoiceNumber: `TEST-${i}`, dueDate: new Date(), placeOfSupply: "33", status: i === 0 ? "UNPAID" : "CANCELLED" } });
      await prisma.purchaseInvoice.create({ data: { ...base, supplierId: supplierIds[1], billNumber: `TEST-${i}`, ourNumber: `TEST-${i}` } });
    }
  });
  afterAll(async () => {
    const where = { tenantId: { in: [tenantId, foreignId] } };
    await prisma.invoice.deleteMany({ where });
    await prisma.purchaseInvoice.deleteMany({ where });
    await prisma.ledgerEntry.deleteMany({ where });
    await prisma.customer.deleteMany({ where });
    await prisma.supplier.deleteMany({ where });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } });
    await prisma.$disconnect();
  });
  for (const type of ["CUSTOMER", "SUPPLIER"] as const) {
    it(`${type}: sorts balances and counts before pagination with exact tenant-scoped totals`, async () => {
      const ids = type === "CUSTOMER" ? customerIds : supplierIds;
      const top = await rankParties(tenantId, type, { page: 1, limit: 1, sortBy: "outstanding", order: "desc" });
      expect(top.total).toBe(3);
      expect(top.items[0].id).toBe(ids[1]);
      expect(top.items[0].outstanding.toFixed(2)).toBe(type === "CUSTOMER" ? "1.00" : "490.07");
      expect((await rankParties(tenantId, type, { page: 1, limit: 1, sortBy: "invoiceCount", order: "desc" })).items[0]).toMatchObject({ id: ids[1], invoiceCount: type === "CUSTOMER" ? 1 : 2 });
      expect((await rankParties(tenantId, type, { page: 2, limit: 1, sortBy: "outstanding", order: "desc" })).items[0].id).toBe(ids[0]);
    });
    it(`${type}: combines status, balance and literal search and handles empty pages`, async () => {
      const ids = type === "CUSTOMER" ? customerIds : supplierIds;
      expect((await rankParties(tenantId, type, { page: 1, limit: 20, activity: "inactive", balance: "due" })).items.map((row) => row.id)).toEqual([ids[1]]);
      expect((await rankParties(tenantId, type, { page: 1, limit: 20, activity: "active", balance: type === "CUSTOMER" ? "settled" : "credit", search: "_%" })).items.map((row) => row.id)).toEqual([ids[2]]);
      expect((await rankParties(tenantId, type, { page: 1, limit: 20, balance: "settled" })).items.map((row) => row.id).sort()).toEqual((type === "CUSTOMER" ? [ids[0], ids[2]] : [ids[0]]).sort());
      expect((await rankParties(tenantId, type, { page: 1, limit: 1, sortBy: "outstanding", order: "asc" })).items[0].id).toBe(type === "CUSTOMER" ? ids[0] : ids[2]);
      expect(await rankParties(tenantId, type, { page: 10, limit: 1 })).toMatchObject({ items: [], total: 3 });
      expect(await rankParties(tenantId, type, { page: 1, limit: 20, activity: "inactive", balance: "credit" })).toMatchObject({ items: [], total: 0 });
    });
  }
});
