import { Router } from "express";
import { z } from "zod";
import { prisma } from "@fii/database";
import { notFound } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { TOPICS, makeEnvelope, publish } from "@fii/kafka";
import { h, parse } from "../http.js";

const triggerBody = z.object({
  cycleType: z.enum(["PREPAID", "POSTPAID"]),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const billingRunsRouter = Router();
billingRunsRouter.use(authenticate);

billingRunsRouter.get("/", authorize("billing_run:read"), h(async (req, res) => {
  const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
  const where = { tenantId: req.auth!.tenantId };
  const [items, total] = await Promise.all([
    prisma.billingRun.findMany({ where, orderBy: [{ periodStart: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.billingRun.count({ where }),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
}));

billingRunsRouter.get("/:id", authorize("billing_run:read"), h(async (req, res) => {
  const run = await prisma.billingRun.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { items: { orderBy: { success: "asc" }, take: 500 } },
  });
  if (!run) throw notFound("Billing run");
  // enrich failed items with subscriber info
  const subIds = run.items.map((i) => i.subscriberId);
  const subs = await prisma.subscriber.findMany({
    where: { id: { in: subIds } },
    select: { id: true, code: true, customer: { select: { name: true } } },
  });
  const byId = new Map(subs.map((s) => [s.id, s]));
  res.json({
    ...run,
    items: run.items.map((i) => ({
      ...i,
      subscriber: byId.get(i.subscriberId) ?? null,
    })),
  });
}));

/** Manual trigger — also serves as "retry failed" for an existing period:
 *  the worker only creates the invoices that don't exist yet. */
billingRunsRouter.post("/trigger", authorize("billing_run:create"), h(async (req, res) => {
  const b = parse(triggerBody, req.body);
  const start = new Date(Date.UTC(b.year, b.month - 1, 1));
  const end = new Date(Date.UTC(b.year, b.month, 0));
  await publish(TOPICS.BILLING_GENERATE, req.auth!.tenantId, makeEnvelope(req.auth!.tenantId, {
    cycleType: b.cycleType,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  }, { actorUserId: req.auth!.sub }));
  res.json({ ok: true, queued: { cycleType: b.cycleType, periodStart: start, periodEnd: end } });
}));
