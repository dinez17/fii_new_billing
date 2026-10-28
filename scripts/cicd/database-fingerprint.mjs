// Run inside the application image. Emits hashes/counts, never raw records.
import { createHash } from "node:crypto";
import { prisma, Prisma } from "/app/packages/database/dist/index.js";
const business = process.argv.includes("--business");
const skip = new Set(business ? ["AuditLog", "RefreshToken", "AccountToken", "NotificationLog", "ReportJob", "ProcessedEvent", "OutboxEvent"] : []);
try {
  const result = await prisma.$transaction(async (tx) => {
    const tables = {};
    for (const model of Prisma.dmmf.datamodel.models.filter((m) => !skip.has(m.name))) {
      const name = model.name.replaceAll('"', '""');
      const rows = await tx.$queryRawUnsafe(`SELECT to_jsonb(r) AS value FROM "${name}" r`);
      const values = rows.map(({ value }) => {
        if (business && model.name === "User") for (const key of ["lastLoginAt", "failedLogins", "lockoutUntil", "updatedAt"]) delete value[key];
        return JSON.stringify(value);
      }).sort();
      tables[model.name] = { count: rows.length, sha256: createHash("sha256").update(JSON.stringify(values)).digest("hex") };
    }
    return { mode: business ? "business" : "full", tables };
  }, { isolationLevel: "RepeatableRead", timeout: 120000 });
  console.log(`FII_DATABASE_FINGERPRINT=${JSON.stringify(result)}`);
} finally { await prisma.$disconnect(); }
