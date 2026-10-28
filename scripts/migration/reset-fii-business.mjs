// One-tenant maintenance operation. Rehearse on a restored backup before --apply.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { PrismaClient, Prisma } = createRequire(new URL("../../packages/database/package.json", import.meta.url))("@prisma/client");
const tenantId = "7ab94e71-ee0f-4e3f-84b3-94d43e99c303", skyId = "08124dcf-095c-4226-acf7-560cae56e5e6";
const args = process.argv.slice(2), rehearse = args.includes("--rehearse"), apply = args.includes("--apply") || rehearse;
const replaceLegacyImport = args.includes("--replace-legacy-import");
if (rehearse) {
  const contents = readFileSync(new URL("../../packages/database/.env", import.meta.url), "utf8");
  const value = /^DATABASE_URL\s*=\s*(.+)$/m.exec(contents)?.[1].trim().replace(/^['"]|['"]$/g, "");
  const url = new URL(value); url.pathname = "/fii_reset_restore_check_20261027"; process.env.DATABASE_URL = url.toString();
}
const backupHash = process.env.RESET_FII_BACKUP_SHA256;
if (apply && !/^[a-f0-9]{64}$/i.test(backupHash ?? "")) throw Error("A verified backup SHA-256 is required");
const prisma = new PrismaClient();
const models = Prisma.dmmf.datamodel.models, byName = new Map(models.map((model) => [model.name, model]));
const clientName = (name) => name[0].toLowerCase() + name.slice(1);
const preserved = new Set(["TenantLicenseEvent", "User", "Role", "AuditLog", "FinancialYear", "NumberSeries", "Setting", "NotificationTemplate"]);
const scoped = models.filter((model) => model.fields.some((field) => field.name === "tenantId" && field.kind === "scalar"));
const relations = (model) => model.fields.filter((field) => field.kind === "object" && field.relationFromFields?.length);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sorted = (rows) => rows.map((row) => JSON.stringify(row)).sort();
function descendantsWhere(model, records) {
  const or = [];
  for (const relation of relations(model)) {
    const parents = records.get(relation.type);
    if (!parents?.length) continue;
    if (relation.relationFromFields.length !== 1) throw Error("Composite relation needs explicit review");
    or.push({ [relation.relationFromFields[0]]: { in: parents.map((row) => row[relation.relationToFields[0]]) } });
  }
  return or.length ? { OR: or } : null;
}
async function includeChildren(tx, records) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const model of models) {
      if (records.has(model.name) || model.fields.some((field) => field.name === "tenantId")) continue;
      const where = descendantsWhere(model, records);
      if (where) { records.set(model.name, await tx[clientName(model.name)].findMany({ where })); changed = true; }
    }
  }
}
async function snapshot(tx, id) {
  const records = new Map([["Tenant", [await tx.tenant.findUniqueOrThrow({ where: { id } })]]]);
  for (const model of scoped) records.set(model.name, await tx[clientName(model.name)].findMany({ where: { tenantId: id } }));
  await includeChildren(tx, records);
  return hash([...records].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => [name, sorted(rows)]));
}
function exactWhere(model, rows) {
  const single = model.fields.find((field) => field.isId);
  if (single) return { [single.name]: { in: rows.map((row) => row[single.name]) } };
  const keys = model.primaryKey?.fields;
  if (!keys) throw Error(`No primary key for ${model.name}`);
  return { OR: rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]]))) };
}
try {
  const db = (await prisma.$queryRaw`SELECT current_database() AS name`)[0].name;
  if (db !== (rehearse ? "fii_reset_restore_check_20261027" : "fii_billing")) throw Error("Unexpected database; refusing reset");
  const result = await prisma.$transaction(async (tx) => {
    // These identifiers come only from the generated Prisma model metadata.
    const tableNames = models.map((model) => model.dbName ?? model.name);
    if (tableNames.some((name) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(name))) throw Error("Unexpected table identifier");
    if (apply) await tx.$executeRawUnsafe(`LOCK TABLE ${tableNames.map((name) => `"${name}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (tenant.subdomain !== "fii" || tenant.name !== "FIRST IDEA INFOTECH") throw Error("Target tenant identity mismatch");
    const skyBefore = await snapshot(tx, skyId);
    const keepBefore = {};
    const preservedWhere = (name) => ({ tenantId, ...(name === "Setting" && replaceLegacyImport ? { group: { not: "LEGACY_IMPORT" } } : {}) });
    for (const name of preserved) if (name !== "User" && name !== "AuditLog") keepBefore[name] = sorted(await tx[clientName(name)].findMany({ where: preservedWhere(name) }));
    const staff = await tx.user.findMany({ where: { tenantId, userType: "STAFF" } });
    const staffRoleIds = sorted(await tx.userRole.findMany({ where: { userId: { in: staff.map((user) => user.id) } } }));
    const records = new Map();
    for (const model of scoped) if (!preserved.has(model.name)) records.set(model.name, await tx[clientName(model.name)].findMany({ where: { tenantId } }));
    records.set("User", await tx.user.findMany({ where: { tenantId, userType: "CUSTOMER" } }));
    if (replaceLegacyImport) records.set("Setting", await tx.setting.findMany({ where: { tenantId, group: "LEGACY_IMPORT" } }));
    await includeChildren(tx, records);
    // Abort on malformed cross-tenant child links instead of deleting another tenant's data.
    for (const [name, rows] of records) for (const relation of relations(byName.get(name))) {
      if (!records.has(relation.type)) continue;
      const parentIds = new Set(records.get(relation.type).map((row) => row[relation.relationToFields[0]]));
      for (const row of rows) { const fk = row[relation.relationFromFields[0]]; if (fk !== null && fk !== undefined && !parentIds.has(fk)) throw Error(`Cross-scope relation in ${name}; manual review required`); }
    }
    const counts = Object.fromEntries([...records].filter(([, rows]) => rows.length).map(([name, rows]) => [name, rows.length]));
    if (!apply) return { mode: "dry-run", tenantId, counts, skyHash: skyBefore };
    const oldEvents = records.get("OutboxEvent") ?? [];
    const suppress = [];
    for (const event of oldEvents) {
      const eventId = event.payload?.eventId;
      if (typeof eventId !== "string") throw Error("Outbox event missing envelope ID; replay needs review");
      for (const consumerGroup of ["ledger-worker", "billing-worker", "notification-worker", "report-worker"]) suppress.push({ consumerGroup, eventId });
    }
    if (suppress.length) await tx.processedEvent.createMany({ data: suppress, skipDuplicates: true });
    await tx.user.updateMany({ where: { tenantId, userType: "STAFF" }, data: { employeeId: null, customerId: null } });
    const portalIds = records.get("User").map((user) => user.id);
    await tx.auditLog.updateMany({ where: { tenantId, userId: { in: portalIds } }, data: { userId: null } });
    const remaining = new Set(records.keys());
    while (remaining.size) {
      const leaf = [...remaining].find((name) => ![...remaining].some((other) => other !== name && relations(byName.get(other)).some((relation) => relation.type === name)));
      if (!leaf) throw Error("Unexpected relation cycle; refusing partial reset");
      const rows = records.get(leaf);
      if (rows.length) { const deleted = await tx[clientName(leaf)].deleteMany({ where: exactWhere(byName.get(leaf), rows) }); if (deleted.count !== rows.length) throw Error(`Deletion count changed for ${leaf}`); }
      remaining.delete(leaf);
    }
    for (const model of scoped) if (!preserved.has(model.name) && await tx[clientName(model.name)].count({ where: { tenantId } })) throw Error(`Residual business rows in ${model.name}`);
    for (const [name, before] of Object.entries(keepBefore)) if (hash(before) !== hash(sorted(await tx[clientName(name)].findMany({ where: preservedWhere(name) })))) throw Error(`Preserved configuration changed: ${name}`);
    const staffAfter = await tx.user.findMany({ where: { tenantId, userType: "STAFF" } });
    const accountFields = (rows) => sorted(rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["employeeId", "customerId", "updatedAt"].includes(key)))));
    if (hash(accountFields(staff)) !== hash(accountFields(staffAfter))) throw Error("Staff account details changed");
    if (hash(staffRoleIds) !== hash(sorted(await tx.userRole.findMany({ where: { userId: { in: staff.map((user) => user.id) } } })))) throw Error("Staff roles changed");
    if (hash(tenant) !== hash(await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }))) throw Error("Tenant or license changed");
    if (skyBefore !== await snapshot(tx, skyId)) throw Error("SKY NETWORK changed; rolling back reset");
    const actor = await tx.user.findFirstOrThrow({ where: { email: "superadmin@platform.local", tenant: { subdomain: "platform" } } });
    await tx.auditLog.create({ data: { tenantId, userId: actor.id, action: "TENANT_BUSINESS_DATA_RESET", entity: "Tenant", entityId: tenantId,
      after: { backupSha256: backupHash, deletedCounts: counts, reason: "User requested clearing existing FII records before Li-Soft historical migration", skyUnchanged: true } } });
    return { mode: rehearse ? "restored-backup-rehearsal" : "live-reset", tenantId, deletedCounts: counts, staffAccountsKept: staff.length, configurationKept: true, skyUnchanged: true, backupSha256: backupHash };
  }, { timeout: 120000, maxWait: 10000, isolationLevel: "Serializable" });
  console.log(JSON.stringify(result));
} finally { await prisma.$disconnect(); }
