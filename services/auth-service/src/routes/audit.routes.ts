import { Router } from "express";
import { Prisma, prisma } from "@fii/database";
import { authenticate, authorize } from "@fii/auth";
import { h, parse } from "../http.js";
import { auditQuery } from "../validators.js";

export const auditRouter = Router();
auditRouter.use(authenticate);

auditRouter.get("/", authorize("audit:read"), h(async (req, res) => {
  const q = parse(auditQuery, req.query);
  const where: Prisma.AuditLogWhereInput = {
    tenantId: req.auth!.tenantId,
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
}));
