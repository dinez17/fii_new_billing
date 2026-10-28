import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { PrismaClient, Prisma } = createRequire(new URL("../packages/database/package.json", import.meta.url))("@prisma/client");
const { cancelExpenseDayBook } = await import("../packages/database/dist/expense-daybook.js");
const tenantId = "7ab94e71-ee0f-4e3f-84b3-94d43e99c303", apply = process.argv.includes("--apply");
const rehearse = process.argv.includes("--rehearse");
const backupSha256 = process.env.EXPENSE_REPAIR_BACKUP_SHA256;
if (apply) assert.match(backupSha256 ?? "", /^[a-f0-9]{64}$/i);
const prisma = new PrismaClient(), models = Prisma.dmmf.datamodel.models;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function preserved(tx) {
  const data = [];
  for (const model of models) {
    const scoped = model.fields.some((field) => field.name === "tenantId");
    const mutable = ["DayBookEntry", "DayBookClosing", "AuditLog"].includes(model.name);
    const rows = await tx[model.name[0].toLowerCase() + model.name.slice(1)].findMany({ where: scoped && mutable ? { tenantId: { not: tenantId } } : {} });
    data.push([model.name, hash(rows.map((row) => JSON.stringify(row)).sort())]);
  }
  return hash(data);
}
try {
  assert.equal((await prisma.$queryRaw`SELECT current_database() AS name`)[0].name, rehearse ? "fii_expense_repair_rehearsal" : "fii_billing");
  const result = await prisma.$transaction(async (tx) => {
    if (apply) {
      const tables = models.map((model) => model.dbName ?? model.name); assert.ok(tables.every((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name)));
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map((name) => `"${name}"`).join(",")} IN EXCLUSIVE MODE`);
    }
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    assert.equal(tenant.subdomain, "fii"); assert.equal(tenant.name, "FIRST IDEA INFOTECH");
    const before = await preserved(tx), cancelled = await tx.expense.findMany({ where: { tenantId, status: "CANCELLED" } });
    const entries = await tx.dayBookEntry.findMany({ where: { tenantId, refType: "EXPENSE", refId: { in: cancelled.map((row) => row.id) } } });
    const removeIds = new Set(entries.map((row) => row.id));
    const sortedHash = (rows) => hash(rows.map((row) => JSON.stringify(row)).sort());
    const unrelatedEntries = sortedHash((await tx.dayBookEntry.findMany({ where: { tenantId } })).filter((row) => !removeIds.has(row.id)));
    const closingMeta = async () => sortedHash(await tx.dayBookClosing.findMany({ where: { tenantId }, select: { id: true, tenantId: true, closingDate: true, closedById: true, createdAt: true } }));
    const closingBefore = await closingMeta();
    if (apply) for (const expense of cancelled) await cancelExpenseDayBook(tx, tenantId, expense.id);
    if (apply) {
      assert.equal(await preserved(tx), before, "Expense records, unrelated records or another tenant changed");
      assert.equal(sortedHash(await tx.dayBookEntry.findMany({ where: { tenantId } })), unrelatedEntries, "Unrelated Day Book entries changed");
      assert.equal(await closingMeta(), closingBefore, "Closed-day identity or status changed");
      assert.equal(await tx.dayBookEntry.count({ where: { tenantId, refType: "EXPENSE", refId: { in: cancelled.map((row) => row.id) } } }), 0);
      await tx.auditLog.create({ data: { tenantId, action: "CANCELLED_EXPENSE_POSTINGS_REPAIRED", entity: "Tenant", entityId: tenantId, after: { backupSha256, expenseIds: cancelled.map((row) => row.id), removedPostings: entries.length } } });
    }
    return { applied: apply, cancelledExpenses: cancelled.length, removedPostings: entries.length, removedTotal: entries.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).toFixed(2), expenseRecordsAndOtherTenantsUnchanged: true, backupSha256 };
  }, { timeout: 120000, isolationLevel: "Serializable" });
  if (process.env.EXPENSE_REPAIR_RESULT_PATH) writeFileSync(process.env.EXPENSE_REPAIR_RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await prisma.$disconnect(); }
