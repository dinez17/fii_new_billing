import express from "express";
import helmet from "helmet";
import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { AppError, badRequest, createLogger, notFound, httpMetrics, mountOps } from "@fii/common";
import { authenticate, authorize, requireCustomer } from "@fii/auth";
import { Prisma, prisma } from "@fii/database";
import { TOPICS, makeEnvelope, startOutboxRelay, writeOutbox } from "@fii/kafka";
import * as svc from "./complaint.service.js";

const log = createLogger("helpdesk-service");

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("helpdesk-service"));
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "helpdesk-service" }));
mountOps(app, { name: "helpdesk-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

// ── Complaints (staff)
const complaints = Router();
complaints.use(authenticate);

complaints.get("/", authorize("complaint:read"), h(async (req, res) => {
  res.json(await svc.listComplaints(req.auth!.tenantId, parse(svc.listQuery, req.query)));
}));
complaints.get("/reports/daily", authorize("complaint:read"), h(async (req, res) => {
  res.json(await svc.dailyReport(req.auth!.tenantId));
}));
complaints.get("/reports/employee-pending", authorize("complaint:read"), h(async (req, res) => {
  res.json(await svc.employeePendingReport(req.auth!.tenantId));
}));
complaints.get("/reports/sla", authorize("complaint:read"), h(async (req, res) => {
  res.json(await svc.slaReport(req.auth!.tenantId));
}));
complaints.get("/:id", authorize("complaint:read"), h(async (req, res) => {
  res.json(await svc.getComplaint(req.auth!.tenantId, req.params.id));
}));
complaints.post("/", authorize("complaint:create"), h(async (req, res) => {
  res.status(201).json(await svc.createComplaint(req.auth!.tenantId, req.auth!.sub, "STAFF", parse(svc.complaintCreateBody, req.body)));
}));
complaints.post("/:id/assign", authorize("complaint:update"), h(async (req, res) => {
  const b = parse(svc.assignBody, req.body);
  res.json(await svc.assignComplaint(req.auth!.tenantId, req.auth!.sub, req.params.id, b.employeeId));
}));
complaints.post("/:id/status", authorize("complaint:update"), h(async (req, res) => {
  const b = parse(svc.statusBody, req.body);
  res.json(await svc.changeStatus(req.auth!.tenantId, req.auth!.sub, req.params.id, b.status, b.notes));
}));
complaints.post("/:id/attachments", authorize("complaint:update"), h(async (req, res) => {
  const b = parse(svc.attachmentBody, req.body);
  res.status(201).json(await svc.addAttachment(req.auth!.tenantId, req.auth!.sub, req.params.id, b.fileName, b.dataUrl));
}));
complaints.get("/:id/attachments/:attId", authorize("complaint:read"), h(async (req, res) => {
  const att = await svc.getAttachment(req.auth!.tenantId, req.params.id, req.params.attId);
  res.json({ fileName: att.fileName, dataUrl: att.fileUrl });
}));

// ── Tasks
const taskBody = z.object({
  complaintId: z.string().uuid().optional(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assignedToId: z.string().uuid().optional(),
  dueDate: z.coerce.date().optional(),
});
const taskListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  assignedToId: z.string().uuid().optional(),
});
const commentBody = z.object({ comment: z.string().min(1).max(1000) });

const tasks = Router();
tasks.use(authenticate);

tasks.get("/", authorize("task:read"), h(async (req, res) => {
  const q = parse(taskListQuery, req.query);
  const where: Prisma.TaskWhereInput = {
    tenantId: req.auth!.tenantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      include: {
        assignedTo: { select: { id: true, name: true } },
        complaint: { select: { complaintNumber: true } },
        _count: { select: { comments: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
}));

tasks.post("/", authorize("task:create"), h(async (req, res) => {
  const b = parse(taskBody, req.body);
  const tenantId = req.auth!.tenantId;
  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: { tenantId, ...b, createdById: req.auth!.sub },
      include: { assignedTo: { select: { name: true, email: true } } },
    });
    await writeOutbox(tx, tenantId, TOPICS.TASK_CREATED, makeEnvelope(tenantId, {
      taskId: created.id,
      title: b.title,
      assignedToId: b.assignedToId,
      assignedToName: created.assignedTo?.name,
      assignedToEmail: created.assignedTo?.email,
      dueDate: b.dueDate?.toISOString(),
    }, { actorUserId: req.auth!.sub }));
    return created;
  });
  res.status(201).json(task);
}));

tasks.get("/:id/comments", authorize("task:read"), h(async (req, res) => {
  const task = await prisma.task.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!task) throw notFound("Task");
  res.json(await prisma.taskComment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } }));
}));
tasks.post("/:id/comments", authorize("task:update"), h(async (req, res) => {
  const b = parse(commentBody, req.body);
  const task = await prisma.task.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!task) throw notFound("Task");
  res.status(201).json(await prisma.taskComment.create({
    data: { taskId: task.id, comment: b.comment, authorId: req.auth!.sub },
  }));
}));

for (const [path, status] of [["start", "IN_PROGRESS"], ["complete", "COMPLETED"], ["cancel", "CANCELLED"]] as const) {
  tasks.post(`/:id/${path}`, authorize("task:update"), h(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const task = await prisma.task.findFirst({ where: { id: req.params.id, tenantId } });
    if (!task) throw notFound("Task");
    if (["COMPLETED", "CANCELLED"].includes(task.status)) throw badRequest(`Task is ${task.status}`);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.task.update({
        where: { id: task.id },
        data: { status, ...(status === "COMPLETED" ? { completedAt: new Date() } : {}) },
      });
      if (status === "COMPLETED") {
        await writeOutbox(tx, tenantId, TOPICS.TASK_COMPLETED, makeEnvelope(tenantId, {
          taskId: task.id, title: task.title,
        }, { actorUserId: req.auth!.sub }));
      }
      return u;
    });
    res.json(updated);
  }));
}

// ── Customer portal complaints
const portal = Router();
portal.use(authenticate, requireCustomer);

portal.get("/", h(async (req, res) => {
  const items = await prisma.complaint.findMany({
    where: { tenantId: req.auth!.tenantId, customerId: req.auth!.customerId! },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, complaintNumber: true, type: true, subject: true,
      status: true, createdAt: true, resolvedAt: true, resolutionNotes: true,
    },
  });
  res.json({ items });
}));
portal.post("/", h(async (req, res) => {
  const b = parse(svc.portalComplaintBody, req.body);
  res.status(201).json(await svc.createComplaint(req.auth!.tenantId, req.auth!.sub, "PORTAL", {
    ...b,
    customerId: req.auth!.customerId!,
    priority: "MEDIUM",
    slaHours: 24,
  }));
}));
portal.get("/:id", h(async (req, res) => {
  res.json(await svc.getComplaint(req.auth!.tenantId, req.params.id, req.auth!.customerId!));
}));

app.use("/api/v1/complaints", complaints);
app.use("/api/v1/tasks", tasks);
app.use("/api/v1/portal/complaints", portal);

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  log.error({ err: String(err), path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: String(err).slice(0, 200) } });
});

const stopRelay = startOutboxRelay();
process.on("SIGINT", () => { stopRelay(); process.exit(0); });

const port = Number(process.env.HELPDESK_SERVICE_PORT ?? 8090);
app.listen(port, () => log.info({ port }, "helpdesk-service listening"));
