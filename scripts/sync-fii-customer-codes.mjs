import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { PrismaClient, Prisma } = createRequire(new URL("../packages/database/package.json", import.meta.url))("@prisma/client");
const { syncCustomerCodePrefix } = await import("../packages/database/dist/customer-codes.js");
const tenantId = "7ab94e71-ee0f-4e3f-84b3-94d43e99c303", apply = process.argv.includes("--apply");
if (apply) assert.match(process.env.CUSTOMER_CODES_BACKUP_SHA256 ?? "", /^[a-f0-9]{64}$/i);
const prisma = new PrismaClient();
const hash = (rows) => createHash("sha256").update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())).digest("hex");
const models = Prisma.dmmf.datamodel.models.filter((model) => model.fields.some((field) => field.name === "tenantId"));
async function unchangedRows(tx, foreign) {
  const result = [];
  for (const model of models) {
    if (!foreign && ["Customer", "NumberSeries", "AuditLog"].includes(model.name)) continue;
    const name = model.name[0].toLowerCase() + model.name.slice(1);
    result.push([name, hash(await tx[name].findMany({ where: { tenantId: foreign ? { not: tenantId } : tenantId } }))]);
  }
  return hash(result);
}
try {
  const database = (await prisma.$queryRaw`SELECT current_database() AS name`)[0].name;
  assert.equal(database, "fii_billing");
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    assert.equal(tenant.subdomain, "fii"); assert.equal(tenant.name, "FIRST IDEA INFOTECH");
    const foreignBefore = await unchangedRows(tx, true), financialBefore = await unchangedRows(tx, false);
    const before = await tx.customer.findMany({ where: { tenantId } });
    const plan = await syncCustomerCodePrefix(tx, tenantId, apply);
    if (apply) {
      const comparable = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["code", "updatedAt"].includes(key))));
      assert.equal(hash(comparable(before)), hash(comparable(await tx.customer.findMany({ where: { tenantId } }))));
      assert.equal(await unchangedRows(tx, true), foreignBefore, "Another tenant changed");
      assert.equal(await unchangedRows(tx, false), financialBefore, "Financial or linked records changed");
      await tx.auditLog.create({ data: { tenantId, action: "CUSTOMER_CODE_PREFIX_SYNCHRONIZED", entity: "Customer", after: { ...plan, backupSha256: process.env.CUSTOMER_CODES_BACKUP_SHA256 } } });
    }
    return { applied: apply, ...plan, otherTenantsUnchanged: true, financialRecordsUnchanged: true };
  }, { isolationLevel: "Serializable", timeout: 120000 });
  if (process.env.CUSTOMER_CODES_RESULT_PATH) writeFileSync(process.env.CUSTOMER_CODES_RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, changes: result.changes.length }));
} finally { await prisma.$disconnect(); }
