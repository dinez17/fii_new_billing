import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, applyStock, StockError } from "../dist/index.js";
import { createInvoice } from "../../../services/billing-service/src/services/invoice.service.js";

const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
d("tenant negative stock policy", () => {
  let tenantId = "", otherTenantId = "", customerId = "";
  const stamp = Date.now();
  async function policy(value: string) {
    await prisma.setting.upsert({ where: { tenantId_group_key: { tenantId, group: "INVENTORY", key: "allowNegativeStock" } }, create: { tenantId, group: "INVENTORY", key: "allowNegativeStock", value }, update: { value } });
  }
  const product = (sku: string, stockQty = 0, owner = tenantId) => prisma.product.create({ data: { tenantId: owner, sku, name: sku, stockQty, salePrice: 100 } });
  const move = (productId: string, quantity: number, type: "SALE_OUT" | "ADJUST_OUT" | "PURCHASE_IN" | "PURCHASE_RETURN_OUT", owner = tenantId) => prisma.$transaction((tx) => applyStock(tx, { tenantId: owner, productId, quantity, type }));
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Stock Policy Test", subdomain: `stock-policy-${stamp}`, stateCode: "33" } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { name: "Other Stock Policy Test", subdomain: `stock-policy-other-${stamp}`, stateCode: "33" } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "C-TEST", name: "Test Customer", phone: "9000000001", stateCode: "33" } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: `TEST-${stamp}`, startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 365 * 86_400_000), isActive: true } });
  });
  afterAll(async () => {
    const tenantIds = [tenantId, otherTenantId].filter(Boolean);
    const invoices = await prisma.invoice.findMany({ where: { tenantId: { in: tenantIds } }, select: { id: true } });
    await prisma.$transaction([
      prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } } }),
      prisma.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.stockMovement.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.product.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.setting.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.numberSeries.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.financialYear.deleteMany({ where: { tenantId: { in: tenantIds } } }),
      prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }),
    ]);
    await prisma.$disconnect();
  });

  it("blocks overselling by default without stock or movement changes", async () => {
    const p = await product("DEFAULT-BLOCK", 1);
    await expect(move(p.id, 2, "SALE_OUT")).rejects.toBeInstanceOf(StockError);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty)).toBe(1);
    expect(await prisma.stockMovement.count({ where: { productId: p.id } })).toBe(0);
  });
  it("allows outward movement below zero only while enabled", async () => {
    await policy("true");
    for (const type of ["SALE_OUT", "ADJUST_OUT", "PURCHASE_RETURN_OUT"] as const) {
      const p = await product(`ALLOWED-${type}`);
      expect((await move(p.id, 2, type)).balanceAfter).toBe(-2);
    }
    await policy("false");
    const p = await product("DISABLED-AGAIN");
    await expect(move(p.id, 1, "SALE_OUT")).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK", statusCode: 409 });
  });
  it("allows replenishment of existing negative stock after disabling", async () => {
    const p = await product("REPLENISH", -5);
    expect((await move(p.id, 2, "PURCHASE_IN")).balanceAfter).toBe(-3);
    await expect(move(p.id, 1, "ADJUST_OUT")).rejects.toBeInstanceOf(StockError);
  });
  it("keeps the setting isolated to its tenant", async () => {
    await policy("true");
    const p = await product("OTHER-TENANT", 0, otherTenantId);
    await expect(move(p.id, 1, "SALE_OUT", otherTenantId)).rejects.toBeInstanceOf(StockError);
  });
  it("serializes concurrent reductions with negative stock disabled", async () => {
    await policy("false");
    const p = await product("CONCURRENT-BLOCK", 1);
    const results = await Promise.allSettled([move(p.id, 1, "SALE_OUT"), move(p.id, 1, "SALE_OUT")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty)).toBe(0);
    expect(await prisma.stockMovement.count({ where: { productId: p.id } })).toBe(1);
  });
  it("does not lose concurrent reductions with negative stock enabled", async () => {
    await policy("true");
    const p = await product("CONCURRENT-ALLOW", 1);
    await Promise.all([move(p.id, 2, "SALE_OUT"), move(p.id, 2, "SALE_OUT")]);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty)).toBe(-3);
    expect(await prisma.stockMovement.count({ where: { productId: p.id } })).toBe(2);
  });
  it("rolls back an entire invoice when disabled and posts it when enabled", async () => {
    const p = await product("INVOICE-POLICY");
    const input = { customerId, invoiceDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), items: [{ productId: p.id, description: p.name, quantity: 1, unitPrice: 100, discount: 0, gstRate: 18 }] };
    await policy("false");
    await expect(createInvoice(tenantId, "stock-test", input)).rejects.toBeInstanceOf(StockError);
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(0);
    await policy("true");
    const invoice = await createInvoice(tenantId, "stock-test", input);
    expect(invoice.id).toBeTruthy();
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty)).toBe(-1);
  });
});
