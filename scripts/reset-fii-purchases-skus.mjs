import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { PrismaClient, Prisma } = createRequire(new URL("../packages/database/package.json", import.meta.url))("@prisma/client");
const { clearTenantPurchases, renumberProductSkus } = await import("../packages/database/dist/purchase-reset.js");
const tenantId = "7ab94e71-ee0f-4e3f-84b3-94d43e99c303", apply = process.argv.includes("--apply");
const rehearse = process.argv.includes("--rehearse");
const backupSha256 = process.env.FII_PURCHASE_RESET_BACKUP_SHA256;
if (apply) assert.match(backupSha256 ?? "", /^[a-f0-9]{64}$/i);
const prisma = new PrismaClient(), models = Prisma.dmmf.datamodel.models;
const modelClient = (name) => name[0].toLowerCase() + name.slice(1);
const hash = (rows) => createHash("sha256").update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())).digest("hex");
const relations = (model) => model.fields.filter((field) => field.kind === "object" && field.relationFromFields?.length);
async function snapshot(tx, id) {
  const records = new Map([["Tenant", [await tx.tenant.findUniqueOrThrow({ where: { id } })]]]);
  for (const model of models.filter((model) => model.fields.some((field) => field.name === "tenantId"))) records.set(model.name, await tx[modelClient(model.name)].findMany({ where: { tenantId: id } }));
  let changed = true;
  while (changed) {
    changed = false;
    for (const model of models) {
      if (records.has(model.name) || model.fields.some((field) => field.name === "tenantId")) continue;
      const or = relations(model).flatMap((relation) => {
        const parent = records.get(relation.type);
        if (!parent?.length) return [];
        assert.equal(relation.relationFromFields.length, 1);
        return [{ [relation.relationFromFields[0]]: { in: parent.map((row) => row[relation.relationToFields[0]]) } }];
      });
      if (or.length) { records.set(model.name, await tx[modelClient(model.name)].findMany({ where: { OR: or } })); changed = true; }
    }
  }
  return records;
}
const supplierModels = new Set(["Supplier", "PurchaseInvoice", "PurchaseInvoiceItem", "PurchaseOrder", "PurchaseOrderItem", "Grn", "PurchaseReturn", "SupplierPayment", "SupplierPaymentAllocation"]);
const supplierTopics = new Set(["purchase.invoice.created", "supplier.payment.paid", "purchase.return.created"]);
const legacyPurchase = (row) => ["user_purchase_bills", "user_purchase_bill_details", "user_purchase_receipt"].includes(row.sourceTable) || row.sourceTable === "user_cust_vendor_details" && row.targetModel === "Supplier";
function preserved(records) {
  return [...records].filter(([name]) => !supplierModels.has(name) && name !== "AuditLog").map(([name, raw]) => {
    let rows = raw;
    if (name === "Product") rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["sku", "updatedAt"].includes(key))));
    if (name === "LedgerEntry") rows = rows.filter((row) => row.partyType !== "SUPPLIER");
    if (name === "DayBookEntry") rows = rows.filter((row) => !["SUPPLIER_PAYMENT", "PURCHASE_INVOICE", "PURCHASE_RETURN"].includes(row.refType));
    if (name === "LegacyRecord") rows = rows.filter((row) => !legacyPurchase(row));
    if (name === "OutboxEvent") rows = rows.filter((row) => !supplierTopics.has(row.topic));
    return [name, hash(rows)];
  });
}
try {
  assert.equal((await prisma.$queryRaw`SELECT current_database() AS name`)[0].name, rehearse ? "fii_purchase_reset_rehearsal" : "fii_billing");
  const result = await prisma.$transaction(async (tx) => {
    if (apply) {
      const tables = models.map((model) => model.dbName ?? model.name); assert.ok(tables.every((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name)));
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map((name) => `"${name}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    assert.equal(tenant.name, "FIRST IDEA INFOTECH"); assert.equal(tenant.subdomain, "fii");
    const otherTenants = await tx.tenant.findMany({ where: { id: { not: tenantId } }, select: { id: true } });
    const otherBefore = new Map();
    for (const other of otherTenants) otherBefore.set(other.id, hash([...await snapshot(tx, other.id)].map(([name, rows]) => [name, hash(rows)])));
    const before = await snapshot(tx, tenantId), preservedBefore = hash(preserved(before));
    const sku = await renumberProductSkus(tx, tenantId, apply);
    const counts = apply ? await clearTenantPurchases(tx, tenantId) : Object.fromEntries([...before].filter(([name]) => supplierModels.has(name)).map(([name, rows]) => [name, rows.length]));
    if (apply) {
      assert.equal(hash(preserved(await snapshot(tx, tenantId))), preservedBefore, "Customer/sales/stock/configuration changed");
      for (const other of otherTenants) assert.equal(hash([...await snapshot(tx, other.id)].map(([name, rows]) => [name, hash(rows)])), otherBefore.get(other.id), "Another tenant changed");
      await tx.auditLog.create({ data: { tenantId, action: "SUPPLIERS_PURCHASES_RESET_AND_SKUS_UPDATED", entity: "Tenant", entityId: tenantId, after: { backupSha256, counts, skuChanges: sku.changes, reason: "User will enter fresh suppliers and purchases", stockAndSalesPreserved: true, otherTenantsPreserved: true } } });
    }
    return { applied: apply, counts, sku, stockAndSalesPreserved: true, otherTenantsPreserved: true, backupSha256 };
  }, { timeout: 120000, maxWait: 10000, isolationLevel: "Serializable" });
  if (process.env.FII_PURCHASE_RESET_RESULT_PATH) writeFileSync(process.env.FII_PURCHASE_RESET_RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, sku: { ...result.sku, changes: result.sku.changes.length } }));
} finally { await prisma.$disconnect(); }
