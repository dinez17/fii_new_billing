import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { PrismaClient, Prisma } = createRequire(new URL("../../packages/database/package.json", import.meta.url))("@prisma/client");
const args = process.argv.slice(2), rehearse = args.includes("--rehearse"), apply = args.includes("--apply") || rehearse;
const packetPath = args.find((value) => !value.startsWith("--")) ?? "reports/migration/lisoft/native-import.json";
const bytes = readFileSync(packetPath), packetHash = createHash("sha256").update(bytes).digest("hex"), packet = JSON.parse(bytes);
const allowed = new Map([["1", ["7ab94e71-ee0f-4e3f-84b3-94d43e99c303", "fii"]], ["30", ["08124dcf-095c-4226-acf7-560cae56e5e6", "skynet"]]]);
const sourceHash = "ac3341389490e32ebdbe7d409b6b5414218eef0b1973858fa01c41096613c08e";
if (packet.sourceHash !== sourceHash || packet.policy !== "hold-conflicting-financial-documents" || packet.companies.length !== 2) throw Error("Unexpected source or import policy");
if (apply && process.env.VERIFIED_IMPORT_PACKET_SHA256?.toLowerCase() !== packetHash) throw Error("Verified packet hash is required");
if (apply && !/^[a-f0-9]{64}$/i.test(process.env.IMPORT_BACKUP_SHA256 ?? "")) throw Error("Verified pre-import backup is required");
if (rehearse) {
  const contents = readFileSync(new URL("../../packages/database/.env", import.meta.url), "utf8");
  const url = new URL(/^DATABASE_URL\s*=\s*(.+)$/m.exec(contents)[1].trim().replace(/^['"]|['"]$/g, ""));
  url.pathname = args.includes("--reset-rehearsal") ? "/fii_reset_restore_check_20261027" : "/fii_legacy_native_check_20261027"; process.env.DATABASE_URL = url.toString();
}
const prisma = new PrismaClient();
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name[0].toLowerCase() + model.name.slice(1), model]));
function dateFields(model, row) {
  const result = { ...row };
  for (const field of models.get(model).fields) if (field.type === "DateTime" && result[field.name]) result[field.name] = new Date(result[field.name]);
  return result;
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sorted = (rows) => rows.map((row) => JSON.stringify(row)).sort();
function expectedTotals(rows, fields) {
  return Object.fromEntries(fields.map((field) => [field, rows.reduce((total, row) => total.add(new Prisma.Decimal(row[field] ?? 0)), new Prisma.Decimal(0)).toFixed(2)]));
}
async function verify(tx, company) {
  const tenantId = company.mapping.tenantId, checks = {};
  for (const [model, rows] of Object.entries(company.rows)) {
    const ids = rows.map((row) => row.id);
    const count = await tx[model].count({ where: { id: { in: ids } } });
    if (count !== rows.length) throw Error(`Count mismatch ${company.mapping.name}/${model}`);
    checks[model] = count;
    if (models.get(model).fields.some((field) => field.name === "tenantId") && await tx[model].count({ where: { id: { in: ids }, tenantId: { not: tenantId } } })) throw Error(`Cross-tenant rows in ${model}`);
  }
  for (const [model, fields] of [["invoice", ["grandTotal", "amountPaid", "taxableValue", "cgst", "sgst", "igst"]], ["payment", ["amount"]], ["purchaseInvoice", ["grandTotal", "amountPaid"]], ["supplierPayment", ["amount"]], ["ledgerEntry", ["debit", "credit"]], ["dayBookEntry", ["amount"]]]) {
    const expected = expectedTotals(company.rows[model], fields);
    const actual = await tx[model].aggregate({ where: { tenantId }, _sum: Object.fromEntries(fields.map((field) => [field, true])) });
    for (const field of fields) if (new Prisma.Decimal(actual._sum[field] ?? 0).toFixed(2) !== expected[field]) throw Error(`Total mismatch ${model}.${field}`);
  }
  const native = await tx.invoice.findMany({ where: { tenantId }, select: { id: true, grandTotal: true, amountPaid: true, status: true, payments: { select: { amount: true } } } });
  for (const invoice of native) {
    const allocated = invoice.payments.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
    if (!allocated.equals(invoice.amountPaid)) throw Error("Invoice allocations do not equal amount paid");
    if (invoice.status !== "CANCELLED" && invoice.amountPaid.gt(invoice.grandTotal)) throw Error("Overpaid invoice slipped through review hold");
  }
  const archives = await tx.legacyRecord.findMany({ where: { tenantId, sourceHash } });
  const byId = new Map(archives.map((row) => [row.id, row]));
  // JSON object key order is immaterial in PostgreSQL JSONB.
  const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());
  for (const row of company.rows.legacyRecord) if (canonical(byId.get(row.id)?.data) !== canonical(row.data)) throw Error("Legacy archive value mismatch");
  return checks;
}
try {
  const database = (await prisma.$queryRaw`SELECT current_database() AS name`)[0].name;
  if (database !== (rehearse ? args.includes("--reset-rehearsal") ? "fii_reset_restore_check_20261027" : "fii_legacy_native_check_20261027" : "fii_billing")) throw Error("Refusing unexpected database");
  const report = await prisma.$transaction(async (tx) => {
    if (apply) {
      const tables = [...models.values()].map((model) => model.dbName ?? model.name);
      if (tables.some((table) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(table))) throw Error("Unexpected table name");
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map((table) => `"${table}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const nonSelectedBefore = {};
    for (const [model, meta] of models) if (meta.fields.some((field) => field.name === "tenantId" && field.isRequired)) {
      nonSelectedBefore[model] = hash(sorted(await tx[model].findMany({ where: { tenantId: { notIn: [...allowed.values()].map(([id]) => id) } } })));
    }
    const results = [];
    for (const company of packet.companies) {
      const { oldCompanyId, tenantId, subdomain } = company.mapping, target = allowed.get(oldCompanyId);
      if (!target || target[0] !== tenantId || target[1] !== subdomain) throw Error("Unapproved tenant mapping");
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      if (tenant.subdomain !== subdomain || tenant.name !== company.mapping.name) throw Error("Target tenant identity changed");
      const userBefore = hash(sorted(await tx.user.findMany({ where: { tenantId } })));
      const settingsBefore = hash(sorted(await tx.setting.findMany({ where: { tenantId, group: { not: "LEGACY_IMPORT" } } })));
      const existing = await tx.setting.findUnique({ where: { tenantId_group_key: { tenantId, group: "LEGACY_IMPORT", key: "lisoft" } } });
      if (existing) {
        if (JSON.parse(existing.value).packetHash !== packetHash) throw Error("A different migration is already present");
        results.push({ tenantId, alreadyImported: true, counts: await verify(tx, company) }); continue;
      }
      for (const model of ["customer", "supplier", "product", "invoice", "payment", "purchaseInvoice", "supplierPayment", "ledgerEntry", "dayBookEntry", "legacyRecord"]) if (await tx[model].count({ where: { tenantId } })) throw Error(`Target is not empty: ${company.mapping.name}/${model}; merge review required`);
      if (company.rows.customer.length > tenant.maxCustomers) throw Error("Licensed customer limit would be exceeded");
      if (!apply) { results.push({ tenantId, ready: true, counts: company.summary.nativeCounts }); continue; }
      const profileFill = Object.fromEntries(Object.entries(company.tenantDefaults).filter(([key]) => tenant[key] === null || tenant[key] === ""));
      const profileKeys = new Set(["gstin", "pan", "addressLine1", "addressLine2", "city", "stateCode", "pincode", "phone", "invoiceTerms", "bankName", "bankIfsc", "bankAccountNo", "bankBranch"]);
      if (Object.keys(profileFill).some((key) => !profileKeys.has(key))) throw Error("Unapproved company-profile field");
      if (Object.keys(profileFill).length) await tx.tenant.update({ where: { id: tenantId }, data: profileFill });
      for (const code of company.financialYears) {
        const year = Number(code.slice(0, 4)), historical = code !== "2026-27";
        await tx.financialYear.upsert({ where: { tenantId_code: { tenantId, code } }, create: { tenantId, code, startDate: new Date(Date.UTC(year, 3, 1)), endDate: new Date(Date.UTC(year + 1, 2, 31, 23, 59, 59, 999)), isActive: !historical, isLocked: historical, lockedAt: historical ? new Date() : null }, update: historical ? { isActive: false, isLocked: true, lockedAt: new Date() } : {} });
        for (const [docType, prefix] of [["INVOICE", "INV"], ["RECEIPT", "RCT"], ["PURCHASE_INVOICE", "PIN"], ["PAYMENT_VOUCHER", "PV"]]) await tx.numberSeries.upsert({ where: { tenantId_docType_fyCode: { tenantId, docType, fyCode: code } }, create: { tenantId, docType, fyCode: code, prefix: `${prefix}/${code}/`, nextNumber: 1, padding: 5 }, update: {} });
      }
      for (const [model, rows] of Object.entries(company.rows)) {
        if (!models.has(model)) throw Error(`Unknown native model ${model}`);
        for (let index = 0; index < rows.length; index += 100) await tx[model].createMany({ data: rows.slice(index, index + 100).map((row) => dateFields(model, row)) });
      }
      const counts = await verify(tx, company);
      const profileComparable = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "updatedAt"));
      if (hash(profileComparable({ ...tenant, ...profileFill })) !== hash(profileComparable(await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })))) throw Error("Company identity/license changed beyond filling blank source-profile fields");
      if (userBefore !== hash(sorted(await tx.user.findMany({ where: { tenantId } })))) throw Error("Accounts were modified");
      if (settingsBefore !== hash(sorted(await tx.setting.findMany({ where: { tenantId, group: { not: "LEGACY_IMPORT" } } })))) throw Error("Company settings were modified");
      const manifest = { ...company.summary, packetHash, sourceHash, importedAt: new Date().toISOString(), backupHash: process.env.IMPORT_BACKUP_SHA256 };
      await tx.setting.create({ data: { tenantId, group: "LEGACY_IMPORT", key: "lisoft", value: JSON.stringify(manifest), isSecret: false } });
      await tx.auditLog.create({ data: { tenantId, action: "LEGACY_IMPORT_COMPLETED_WITH_REVIEW", entity: "LegacyRecord", after: { sourceHash, packetHash, counts, heldDocuments: Object.keys(company.summary.heldDocuments).length, backupHash: process.env.IMPORT_BACKUP_SHA256 } } });
      results.push({ tenantId, name: tenant.name, counts, heldFinancialDocuments: Object.keys(company.summary.heldDocuments).length, financialYears: company.financialYears });
    }
    for (const [model, before] of Object.entries(nonSelectedBefore)) if (before !== hash(sorted(await tx[model].findMany({ where: { tenantId: { notIn: [...allowed.values()].map(([id]) => id) } } })))) throw Error(`Other tenants changed: ${model}`);
    return { mode: apply ? rehearse ? "native-rehearsal" : "live-native-import" : "dry-run", packetHash, results, otherTenantsUnchanged: true };
  }, { isolationLevel: "Serializable", timeout: 300000, maxWait: 10000 });
  console.log(JSON.stringify(report));
} finally { await prisma.$disconnect(); }
