import { createHash } from "node:crypto";
import express, { type Request, type Response, type RequestHandler } from "express";
import { authenticate, authorize } from "@fii/auth";
import { badRequest, encryptSecret, decryptSecret, notFound } from "@fii/common";
import { createTenantBackup, restoreTenantBackup, validateTenantBackup, tenantBackupCounts, TenantBackupError, prisma, type TenantBackup } from "@fii/database";

export const tenantBackupRouter = express.Router();
const handle = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch((e) => next(e instanceof TenantBackupError ? badRequest(e.message) : e)); };
const prefix = "FII-TENANT-BACKUP-1\n";
export const encodeBackup = (backup: TenantBackup) => prefix + encryptSecret(JSON.stringify(backup));
export function decodeBackup(body: Buffer, tenantId: string) {
  let decoded: unknown;
  try {
    const text = body.toString("utf8");
    if (!text.startsWith(prefix)) throw new Error("format");
    decoded = JSON.parse(decryptSecret(text.slice(prefix.length)));
  } catch { throw badRequest("Invalid or damaged tenant backup. Whole-database dumps and backups from another installation are not accepted."); }
  return validateTenantBackup(decoded, tenantId);
}
const download = (res: Response, contents: string, tenantId: string, label = "backup") => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="fii-tenant-${tenantId}-${label}-${new Date().toISOString().slice(0, 10)}.fiibak"`);
  res.send(contents);
};
tenantBackupRouter.use(authenticate, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
tenantBackupRouter.get("/", authorize("backup:read"), handle(async (req, res) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: req.auth!.tenantId }, select: { id: true, name: true } });
  const recoveries = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: "TENANT_RESTORE_RECOVERY" }, select: { id: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10 });
  res.json({ available: /^[0-9a-f]{64}$/i.test(process.env.MASTER_ENCRYPTION_KEY ?? ""), scope: "tenant", tenant, recoveries });
}));
tenantBackupRouter.get("/download", authorize("backup:export"), handle(async (req, res) => {
  download(res, encodeBackup(await createTenantBackup(req.auth!.tenantId)), req.auth!.tenantId);
}));
tenantBackupRouter.get("/recovery/:id", authorize("backup:export"), handle(async (req, res) => {
  const entry = await prisma.auditLog.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId, action: "TENANT_RESTORE_RECOVERY" } });
  const data = entry?.before as { encryptedBackup?: string } | null;
  if (!data?.encryptedBackup) throw notFound("Recovery backup");
  download(res, data.encryptedBackup, req.auth!.tenantId, "before-restore");
}));
tenantBackupRouter.post(["/inspect", "/restore"], authorize("backup:update"), express.raw({ type: "application/octet-stream", limit: "256mb" }), handle(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest("Choose a tenant backup file first");
  const backup = decodeBackup(req.body, req.auth!.tenantId);
  const hash = createHash("sha256").update(req.body).digest("hex");
  if (req.path === "/inspect") { res.json({ tenantId: backup.tenantId, createdAt: backup.createdAt, companyName: backup.company.name, counts: tenantBackupCounts(backup), sha256: hash }); return; }
  if (req.get("X-Backup-Confirmation") !== hash || req.get("X-Restore-Confirm") !== "RESTORE") throw badRequest("Review the backup and confirm RESTORE before continuing");
  const result = await restoreTenantBackup(req.auth!.tenantId, req.auth!.sub, backup, encodeBackup);
  res.json({ ...result, restoredBytes: req.body.length });
}));
