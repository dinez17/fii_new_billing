import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "@fii/auth";
import { prisma, type Prisma } from "@fii/database";
import { badRequest, notFound } from "@fii/common";
import type { Request, RequestHandler, Response } from "express";

const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };
export const legacyImportsRouter = Router();
const approvalGroup = "LEGACY_REVIEW_APPROVAL";
legacyImportsRouter.use(authenticate, authorize("backup:read"), (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
legacyImportsRouter.get("/summary", h(async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [groups, manifest] = await Promise.all([
    prisma.legacyRecord.groupBy({ by: ["sourceTable", "status"], where: { tenantId }, _count: true }),
    prisma.setting.findUnique({ where: { tenantId_group_key: { tenantId, group: "LEGACY_IMPORT", key: "lisoft" } } }),
  ]);
  res.json({ groups: groups.map((group) => ({ sourceTable: group.sourceTable, status: group.status, count: group._count })), manifest: manifest ? JSON.parse(manifest.value) : null });
}));
legacyImportsRouter.get("/records", h(async (req, res) => {
  const parsed = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(["IMPORTED", "REVIEW", "ARCHIVED"]).optional(), sourceTable: z.string().regex(/^user_[a-z0-9_]+$/).optional(), search: z.string().max(150).optional() }).safeParse(req.query);
  if (!parsed.success) throw badRequest("Invalid archive filters");
  const { page, limit, status, sourceTable, search } = parsed.data;
  const where: Prisma.LegacyRecordWhereInput = { tenantId: req.auth!.tenantId, status, sourceTable,
    ...(search ? { OR: [{ sourceId: { contains: search } }, { reason: { contains: search, mode: "insensitive" } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.legacyRecord.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ sourceTable: "asc" }, { sourceId: "asc" }], select: { id: true, sourceTable: true, sourceId: true, status: true, reason: true, targetModel: true, targetId: true } }),
    prisma.legacyRecord.count({ where }),
  ]);
  const approvals = await prisma.setting.findMany({ where: { tenantId: req.auth!.tenantId, group: approvalGroup, key: { in: items.map((item) => item.id) } } });
  res.json({ items: items.map((item) => ({ ...item, approval: approvals.find((approval) => approval.key === item.id) ? JSON.parse(approvals.find((approval) => approval.key === item.id)!.value) : null })), total, page, limit });
}));
legacyImportsRouter.post("/approve-all", authorize("backup:update"), h(async (req, res) => {
  const body = z.object({ note: z.string().trim().min(10).max(2000), confirm: z.literal(true) }).strict().safeParse(req.body);
  if (!body.success) throw badRequest("Confirm bulk approval and enter a reconciliation note of 10–2000 characters");
  const tenantId = req.auth!.tenantId;
  const count = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; sourceHash: string }[]>`SELECT id, "sourceHash" FROM "LegacyRecord" WHERE "tenantId" = ${tenantId} AND status = 'REVIEW' AND "sourceTable" IN ('user_bills', 'user_purchase_bills') ORDER BY id FOR UPDATE`;
    let approved = 0;
    for (const row of rows) {
      const key = { tenantId, group: approvalGroup, key: row.id };
      const previous = await tx.setting.findUnique({ where: { tenantId_group_key: key } });
      if (previous && JSON.parse(previous.value).approved) continue;
      const approval = { approved: true, note: body.data.note, reviewedBy: req.auth!.sub, reviewedAt: new Date().toISOString(), sourceHash: row.sourceHash, bulk: true };
      await tx.setting.upsert({ where: { tenantId_group_key: key }, create: { ...key, value: JSON.stringify(approval), isSecret: false }, update: { value: JSON.stringify(approval) } });
      await tx.auditLog.create({ data: { tenantId, userId: req.auth!.sub, action: "LEGACY_REVIEW_APPROVED", entity: "LegacyRecord", entityId: row.id, before: previous ? JSON.parse(previous.value) : undefined, after: approval } });
      approved++;
    }
    return approved;
  }, { timeout: 30000 });
  res.json({ approved: count, message: "Review decisions saved. Financial records remain held pending reconciled import." });
}));
legacyImportsRouter.post("/records/:id/approval", authorize("backup:update"), h(async (req, res) => {
  const body = z.object({ approved: z.boolean(), note: z.string().trim().min(10).max(2000) }).strict().safeParse(req.body);
  if (!body.success) throw badRequest("Enter a reconciliation note of 10–2000 characters");
  const tenantId = req.auth!.tenantId;
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "LegacyRecord" WHERE id = ${req.params.id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (!rows.length) throw notFound("Legacy record");
    const row = await tx.legacyRecord.findUniqueOrThrow({ where: { id: rows[0]!.id } });
    if (row.status !== "REVIEW" || !["user_bills", "user_purchase_bills"].includes(row.sourceTable)) throw badRequest("Approve the held parent invoice, not its items or receipts");
    const key = { tenantId, group: approvalGroup, key: row.id };
    const previous = await tx.setting.findUnique({ where: { tenantId_group_key: key } });
    const approval = { approved: body.data.approved, note: body.data.note, reviewedBy: req.auth!.sub, reviewedAt: new Date().toISOString(), sourceHash: row.sourceHash };
    await tx.setting.upsert({ where: { tenantId_group_key: key }, create: { ...key, value: JSON.stringify(approval), isSecret: false }, update: { value: JSON.stringify(approval) } });
    await tx.auditLog.create({ data: { tenantId, userId: req.auth!.sub, action: body.data.approved ? "LEGACY_REVIEW_APPROVED" : "LEGACY_REVIEW_APPROVAL_WITHDRAWN", entity: "LegacyRecord", entityId: row.id, before: previous ? JSON.parse(previous.value) : undefined, after: approval } });
    return approval;
  });
  res.json({ approval: result, message: "Review decision saved. Financial records remain held pending reconciled import." });
}));
legacyImportsRouter.get("/records/:id", h(async (req, res) => {
  const row = await prisma.legacyRecord.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!row) throw notFound("Legacy record");
  res.json(row);
}));
