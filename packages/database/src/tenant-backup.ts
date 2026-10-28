import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

// Access control, licensing, audit history and running jobs must never be replaced
// by a tenant upload. Child tables are included through their owning business row.
const excluded = new Set(["Tenant", "TenantLicenseEvent", "User", "AccountToken", "Role", "Permission", "RolePermission", "UserRole", "RefreshToken", "AuditLog", "WebhookEvent", "OutboxEvent", "ProcessedEvent", "ReportJob", "NotificationLog"]);
const models = Prisma.dmmf.datamodel.models.filter((m) => !excluded.has(m.name));
const names = new Set(models.map((m) => m.name));
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
const ordered: typeof models = [];
for (const model of models) {
  const visit = (m: typeof model, chain: string[]) => {
    if (ordered.includes(m)) return;
    if (chain.includes(m.name)) throw new Error("Cyclic backup schema; review restore ordering");
    for (const relation of m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length && names.has(f.type))) {
      visit(models.find((p) => p.name === relation.type)!, [...chain, m.name]);
    }
    ordered.push(m);
  };
  visit(model, []);
}
const signature = createHash("sha256").update(JSON.stringify(ordered.map((m) => [m.name, m.fields.filter((f) => f.kind !== "object").map((f) => [f.name, f.type, f.isList, f.isRequired])]))).digest("hex");
const companyFields = ["name", "legalName", "gstin", "pan", "addressLine1", "addressLine2", "city", "stateCode", "pincode", "phone", "email", "logoUrl", "signatureUrl", "invoiceTerms", "bankPayableAt", "bankName", "bankBranch", "bankAccountNo", "bankIfsc"];
type Row = Record<string, unknown>;
export interface TenantBackup {
  format: "fii-tenant-business-v1"; schema: string; tenantId: string; createdAt: string;
  company: Row; tables: Record<string, Row[]>;
}
export class TenantBackupError extends Error {}

function scope(name: string, alias = "r", depth = 0): string {
  const model = models.find((m) => m.name === name)!;
  if (model.fields.some((f) => f.name === "tenantId")) return `${alias}."tenantId" = $1`;
  const owner = model.fields.find((f) => f.kind === "object" && f.relationFromFields?.length && names.has(f.type));
  if (!owner || owner.relationFromFields!.length !== 1 || owner.relationToFields!.length !== 1) throw new Error(`Missing backup owner: ${name}`);
  const parent = `p${depth}`;
  return `EXISTS (SELECT 1 FROM ${quote(owner.type)} ${parent} WHERE ${parent}.${quote(owner.relationToFields![0])} = ${alias}.${quote(owner.relationFromFields![0])} AND ${scope(owner.type, parent, depth + 1)})`;
}
// Fail closed if a new model cannot be safely assigned to its tenant.
for (const model of models) scope(model.name);

async function snapshot(tx: Prisma.TransactionClient, tenantId: string): Promise<TenantBackup> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const company = Object.fromEntries(companyFields.map((key) => [key, (tenant as unknown as Row)[key]]));
  const tables: TenantBackup["tables"] = {};
  for (const m of ordered) {
    const rows = await tx.$queryRawUnsafe<{ data: Row }[]>(`SELECT to_jsonb(r) AS data FROM ${quote(m.name)} r WHERE ${scope(m.name)}`, tenantId);
    tables[m.name] = rows.map((row) => row.data);
  }
  return { format: "fii-tenant-business-v1", schema: signature, tenantId, createdAt: new Date().toISOString(), company, tables };
}
export function createTenantBackup(tenantId: string) {
  return prisma.$transaction((tx) => snapshot(tx, tenantId), { isolationLevel: "RepeatableRead", timeout: 120_000 });
}
export function validateTenantBackup(value: unknown, tenantId: string): TenantBackup {
  const b = value as TenantBackup;
  if (!b || b.format !== "fii-tenant-business-v1" || b.schema !== signature) throw new TenantBackupError("Unsupported backup or database version. Use a tenant backup from this software version.");
  if (b.tenantId !== tenantId) throw new TenantBackupError("This backup belongs to another tenant. It cannot be restored here.");
  if (!b.tables || Object.keys(b.tables).length !== ordered.length || !b.company || Object.keys(b.company).some((k) => !companyFields.includes(k))) throw new TenantBackupError("Invalid backup contents");
  for (const m of ordered) {
    const rows = b.tables[m.name];
    const fields = m.fields.filter((f) => f.kind !== "object").map((f) => f.name);
    if (!Array.isArray(rows) || rows.some((r) => !r || Object.keys(r).length !== fields.length || Object.keys(r).some((k) => !fields.includes(k)) || ("tenantId" in r && r.tenantId !== tenantId))) throw new TenantBackupError(`Invalid tenant data in ${m.name}`);
    // Verify every declared business foreign key is contained in this snapshot.
    for (const f of m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length && names.has(f.type))) {
      const keys = new Set((b.tables[f.type] ?? []).map((r) => JSON.stringify(f.relationToFields!.map((k) => r[k]))));
      if (rows.some((r) => f.relationFromFields!.every((k) => r[k] !== null) && !keys.has(JSON.stringify(f.relationFromFields!.map((k) => r[k]))))) throw new TenantBackupError(`Invalid related records in ${m.name}`);
    }
  }
  return b;
}
export const tenantBackupCounts = (b: TenantBackup) => Object.fromEntries(Object.entries(b.tables).map(([name, rows]) => [name, rows.length]));

export async function restoreTenantBackup(tenantId: string, userId: string, input: unknown, encode: (b: TenantBackup) => string) {
  const backup = validateTenantBackup(input, tenantId);
  return prisma.$transaction(async (tx) => {
    // Locks block concurrent writes, including child rows without tenantId. Reads
    // remain available. No schema changes, TRUNCATE or cascade deletes are used.
    const lockNames = [...ordered.map((m) => m.name), "Tenant", "User", "AuditLog", "OutboxEvent", "ReportJob"].sort();
    await tx.$executeRawUnsafe(`LOCK TABLE ${lockNames.map(quote).join(", ")} IN EXCLUSIVE MODE`);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if ((backup.tables.Customer?.length ?? 0) > tenant.maxCustomers) throw new TenantBackupError("Backup exceeds this tenant's current customer license limit");
    if (await tx.outboxEvent.count({ where: { tenantId, publishedAt: null } }) || await tx.reportJob.count({ where: { tenantId, status: { in: ["QUEUED", "PROCESSING"] } } }) || await tx.billingRun.count({ where: { tenantId, status: { in: ["PENDING", "RUNNING"] } } })) throw new TenantBackupError("Background work is pending. Wait for billing, payment and report processing to finish, then retry.");
    const before = await snapshot(tx, tenantId);
    const recovery = await tx.auditLog.create({ data: { tenantId, userId, action: "TENANT_RESTORE_RECOVERY", entity: "Tenant", entityId: tenantId, before: { encryptedBackup: encode(before) }, after: { restoredBackupDate: backup.createdAt, counts: tenantBackupCounts(backup) } } });
    const users = await tx.user.findMany({ where: { tenantId }, select: { id: true, customerId: true, employeeId: true } });
    await tx.user.updateMany({ where: { tenantId }, data: { customerId: null, employeeId: null } });
    for (const m of [...ordered].reverse()) await tx.$executeRawUnsafe(`DELETE FROM ${quote(m.name)} r WHERE ${scope(m.name)}`, tenantId);
    for (const m of ordered) {
      const rows = backup.tables[m.name];
      for (let i = 0; i < rows.length; i += 500) {
        await tx.$executeRawUnsafe(`INSERT INTO ${quote(m.name)} SELECT * FROM jsonb_populate_recordset(NULL::${quote(m.name)}, $1::jsonb)`, JSON.stringify(rows.slice(i, i + 500)));
      }
    }
    const customers = new Set(backup.tables.Customer.map((r) => r.id));
    const employees = new Set(backup.tables.Employee.map((r) => r.id));
    for (const u of users) await tx.user.update({ where: { id: u.id }, data: { customerId: customers.has(u.customerId) ? u.customerId : null, employeeId: employees.has(u.employeeId) ? u.employeeId : null } });
    await tx.tenant.update({ where: { id: tenantId }, data: backup.company });
    return { ok: true, recoveryId: recovery.id, counts: tenantBackupCounts(backup) };
  }, { timeout: 120_000, maxWait: 15_000 });
}
