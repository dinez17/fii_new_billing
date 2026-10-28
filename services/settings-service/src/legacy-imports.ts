import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "@fii/auth";
import { prisma, type Prisma } from "@fii/database";
import { badRequest, notFound } from "@fii/common";
import type { Request, RequestHandler, Response } from "express";

const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };
export const legacyImportsRouter = Router();
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
  res.json({ items, total, page, limit });
}));
legacyImportsRouter.get("/records/:id", h(async (req, res) => {
  const row = await prisma.legacyRecord.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!row) throw notFound("Legacy record");
  res.json(row);
}));
