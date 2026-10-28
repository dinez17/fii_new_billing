import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { badRequest, notFound } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { Prisma, prisma } from "@fii/database";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

const STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEK_OFF"] as const;

const bulkBody = z.object({
  date: z.coerce.date(),
  entries: z.array(z.object({
    employeeId: z.string().uuid(),
    status: z.enum(STATUSES),
    checkIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    checkOut: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    overtimeHours: z.coerce.number().min(0).max(16).default(0),
  })).min(1).max(500),
});

const leaveBody = z.object({
  employeeId: z.string().uuid(),
  leaveType: z.enum(["CASUAL", "SICK", "EARNED", "LOP"]),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  reason: z.string().max(300).optional(),
}).refine((b) => b.toDate >= b.fromDate, { message: "toDate before fromDate" });

const dayOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const withTime = (date: Date, hm?: string) => {
  if (!hm) return undefined;
  const [hh, mm] = hm.split(":").map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh, mm));
};

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

/** Day sheet: every active employee + their attendance row for the date (if any). */
attendanceRouter.get("/", authorize("attendance:read"), h(async (req, res) => {
  const q = parse(z.object({ date: z.coerce.date() }), req.query);
  const date = dayOnly(q.date);
  const [employees, rows] = await Promise.all([
    prisma.employee.findMany({
      where: { tenantId: req.auth!.tenantId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, department: { select: { name: true } } },
    }),
    prisma.attendance.findMany({ where: { tenantId: req.auth!.tenantId, date } }),
  ]);
  const byEmp = new Map(rows.map((r) => [r.employeeId, r]));
  res.json(employees.map((e) => ({
    employee: e,
    attendance: byEmp.get(e.id) ?? null,
  })));
}));

attendanceRouter.post("/bulk", authorize("attendance:create"), h(async (req, res) => {
  const b = parse(bulkBody, req.body);
  const tenantId = req.auth!.tenantId;
  const date = dayOnly(b.date);
  if (date > dayOnly(new Date())) throw badRequest("Cannot mark attendance for future dates");

  for (const e of b.entries) {
    const checkIn = withTime(date, e.checkIn);
    const checkOut = withTime(date, e.checkOut);
    if (checkIn && checkOut && checkOut <= checkIn) throw badRequest("check-out must be after check-in");
    await prisma.attendance.upsert({
      where: { tenantId_employeeId_date: { tenantId, employeeId: e.employeeId, date } },
      create: {
        tenantId, employeeId: e.employeeId, date, status: e.status,
        checkIn, checkOut, overtimeHours: new Prisma.Decimal(e.overtimeHours),
      },
      update: { status: e.status, checkIn, checkOut, overtimeHours: new Prisma.Decimal(e.overtimeHours) },
    });
  }
  res.json({ ok: true, marked: b.entries.length });
}));

/** Monthly summary per employee. */
attendanceRouter.get("/monthly", authorize("attendance:read"), h(async (req, res) => {
  const q = parse(z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }), req.query);
  const from = new Date(Date.UTC(q.year, q.month - 1, 1));
  const to = new Date(Date.UTC(q.year, q.month, 0));
  const rows = await prisma.attendance.groupBy({
    by: ["employeeId", "status"],
    where: { tenantId: req.auth!.tenantId, date: { gte: from, lte: to } },
    _count: true,
    _sum: { overtimeHours: true },
  });
  const employees = await prisma.employee.findMany({
    where: { tenantId: req.auth!.tenantId },
    select: { id: true, code: true, name: true },
  });
  const byEmp = new Map<string, Record<string, number> & { overtimeHours?: number }>();
  for (const r of rows) {
    const rec = byEmp.get(r.employeeId) ?? {};
    rec[r.status] = r._count;
    rec.overtimeHours = (rec.overtimeHours ?? 0) + Number(r._sum.overtimeHours ?? 0);
    byEmp.set(r.employeeId, rec);
  }
  res.json(employees
    .filter((e) => byEmp.has(e.id))
    .map((e) => ({ employee: e, ...byEmp.get(e.id) })));
}));

// ── Leaves
export const leavesRouter = Router();
leavesRouter.use(authenticate);

leavesRouter.get("/", authorize("leave:read"), h(async (req, res) => {
  const q = parse(z.object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  }), req.query);
  res.json(await prisma.leaveRequest.findMany({
    where: { tenantId: req.auth!.tenantId, ...(q.status ? { status: q.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { employee: { select: { id: true, code: true, name: true } } },
  }));
}));

leavesRouter.post("/", authorize("leave:create"), h(async (req, res) => {
  const b = parse(leaveBody, req.body);
  const tenantId = req.auth!.tenantId;
  const employee = await prisma.employee.findFirst({ where: { id: b.employeeId, tenantId } });
  if (!employee) throw notFound("Employee");
  const days = Math.round((dayOnly(b.toDate).getTime() - dayOnly(b.fromDate).getTime()) / 86_400_000) + 1;
  res.status(201).json(await prisma.leaveRequest.create({
    data: {
      tenantId, employeeId: b.employeeId, leaveType: b.leaveType,
      fromDate: dayOnly(b.fromDate), toDate: dayOnly(b.toDate),
      days: new Prisma.Decimal(days), reason: b.reason,
    },
  }));
}));

leavesRouter.post("/:id/approve", authorize("leave:approve"), h(async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const leave = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, tenantId } });
  if (!leave) throw notFound("Leave request");
  if (leave.status !== "PENDING") throw badRequest(`Already ${leave.status}`);

  // approval writes LEAVE (or ABSENT for LOP) attendance rows for the span
  const status = leave.leaveType === "LOP" ? "ABSENT" : "LEAVE";
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id: leave.id },
      data: { status: "APPROVED", approvedById: req.auth!.sub },
    });
    for (let t = leave.fromDate.getTime(); t <= leave.toDate.getTime(); t += 86_400_000) {
      const date = new Date(t);
      await tx.attendance.upsert({
        where: { tenantId_employeeId_date: { tenantId, employeeId: leave.employeeId, date } },
        create: { tenantId, employeeId: leave.employeeId, date, status, notes: `leave: ${leave.leaveType}` },
        update: { status, notes: `leave: ${leave.leaveType}` },
      });
    }
  });
  res.json({ ok: true });
}));

leavesRouter.post("/:id/reject", authorize("leave:approve"), h(async (req, res) => {
  const leave = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!leave) throw notFound("Leave request");
  if (leave.status !== "PENDING") throw badRequest(`Already ${leave.status}`);
  await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: "REJECTED", approvedById: req.auth!.sub } });
  res.json({ ok: true });
}));
