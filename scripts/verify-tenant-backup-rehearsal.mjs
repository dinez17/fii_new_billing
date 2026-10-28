import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { prisma, Prisma, createTenantBackup, restoreTenantBackup, validateTenantBackup } from "../packages/database/dist/index.js";
if (new URL(process.env.DATABASE_URL).pathname !== "/fii_tenant_backup_rehearsal") throw new Error("Isolated rehearsal database required");
const tenantId = "7ab94e71-ee0f-4e3f-84b3-94d43e99c303";
const quote = (s) => `"${s.replaceAll('"', '""')}"`;
const digest = (rows) => createHash("sha256").update(JSON.stringify(rows.map((r) => JSON.stringify(r)).sort())).digest("hex");
async function otherTenantHashes() {
  const result = {};
  for (const m of Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "tenantId"))) {
    result[m.name] = digest(await prisma.$queryRawUnsafe(`SELECT to_jsonb(r) AS data FROM ${quote(m.name)} r WHERE "tenantId" <> $1 OR "tenantId" IS NULL`, tenantId));
  }
  result.Tenant = digest(await prisma.tenant.findMany({ where: { id: { not: tenantId } } }));
  return result;
}
try {
  const backup = validateTenantBackup(await createTenantBackup(tenantId), tenantId);
  const beforeOther = await otherTenantHashes();
  const beforeUsers = await prisma.user.findMany({ where: { tenantId }, select: { id: true, email: true, passwordHash: true, status: true } });
  const license = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { subdomain: true, licenseStatus: true, maxUsers: true, maxCustomers: true, licenseKeyHash: true } });
  const actor = beforeUsers[0].id;
  const result = await restoreTenantBackup(tenantId, actor, backup, JSON.stringify);
  const after = await createTenantBackup(tenantId);
  assert.deepEqual(after.company, backup.company);
  for (const [name, rows] of Object.entries(backup.tables)) assert.equal(digest(after.tables[name]), digest(rows), `Business table changed: ${name}`);
  assert.deepEqual(await otherTenantHashes(), beforeOther);
  assert.deepEqual(await prisma.user.findMany({ where: { tenantId }, select: { id: true, email: true, passwordHash: true, status: true } }), beforeUsers);
  assert.deepEqual(await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { subdomain: true, licenseStatus: true, maxUsers: true, maxCustomers: true, licenseKeyHash: true } }), license);
  const evidence = { verified: true, tenantId, businessModels: Object.keys(backup.tables).length, rows: Object.values(backup.tables).reduce((n, r) => n + r.length, 0), otherTenantHashesUnchanged: true, credentialsAndLicenseUnchanged: true, recoveryCreated: !!result.recoveryId };
  if (process.env.BACKUP_REHEARSAL_RESULT) writeFileSync(process.env.BACKUP_REHEARSAL_RESULT, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await prisma.$disconnect(); }
