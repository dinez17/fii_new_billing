import express from "express";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { AppError, badRequest, createLogger, notFound, httpMetrics, mountOps } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { Prisma, prisma } from "@fii/database";
import { startOutboxRelay } from "@fii/kafka";
import { attendanceRouter, leavesRouter } from "./attendance.js";
import { payrollRouter } from "./payroll.js";

const log = createLogger("hr-service");

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

const departmentBody = z.object({ name: z.string().min(2).max(80) });

// salary structure components — persisted as Json [{ name, amount }]
const salaryComponents = z
  .array(z.object({ name: z.string().min(1).max(60), amount: z.coerce.number().min(0) }))
  .max(30);

const employeeBody = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  phone: z.string().min(10).max(15),
  departmentId: z.string().uuid().optional(),
  designation: z.string().max(80).optional(),
  joiningDate: z.coerce.date(),
  basicSalary: z.coerce.number().min(0).default(0),
  allowances: salaryComponents.optional(),
  deductions: salaryComponents.optional(),
  status: z.enum(["ACTIVE", "ON_NOTICE", "RESIGNED", "TERMINATED"]).optional(),
  createLogin: z.coerce.boolean().default(true), // auto-create a staff login (needs email)
  roleCode: z.string().max(40).default("TECHNICIAN"), // system role for the new login
});

/** URL-safe random password like "x7Kp-Q2mNv4t" */
const randomPassword = (): string => {
  const raw = randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
  return `${raw.slice(0, 4)}-${raw.slice(4, 12)}`;
};

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("hr-service"));
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "hr-service" }));
mountOps(app, { name: "hr-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

// ── Departments
app.get("/api/v1/departments", authenticate, authorize("department:read"), h(async (req, res) => {
  res.json(await prisma.department.findMany({
    where: { tenantId: req.auth!.tenantId, isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true } } },
  }));
}));
app.post("/api/v1/departments", authenticate, authorize("department:create"), h(async (req, res) => {
  const b = parse(departmentBody, req.body);
  try {
    res.status(201).json(await prisma.department.create({ data: { tenantId: req.auth!.tenantId, name: b.name } }));
  } catch {
    throw badRequest("Department already exists");
  }
}));

// ── Employees
app.get("/api/v1/employees", authenticate, authorize("employee:read"), h(async (req, res) => {
  const q = parse(z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().optional(),
    active: z.coerce.boolean().default(false),
  }), req.query);
  const where: Prisma.EmployeeWhereInput = {
    tenantId: req.auth!.tenantId,
    ...(q.active ? { status: "ACTIVE" } : {}),
    ...(q.search
      ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { code: { contains: q.search, mode: "insensitive" } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.employee.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { name: "asc" },
      include: { department: { select: { name: true } } },
    }),
    prisma.employee.count({ where }),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
}));

app.post("/api/v1/employees", authenticate, authorize("employee:create"), h(async (req, res) => {
  const b = parse(employeeBody, req.body);
  const tenantId = req.auth!.tenantId;
  const result = await prisma.$transaction(async (tx) => {
    const count = await tx.employee.count({ where: { tenantId } });
    const employee = await tx.employee.create({
      data: {
        tenantId,
        code: `EMP-${String(count + 1).padStart(4, "0")}`,
        name: b.name,
        email: b.email,
        phone: b.phone,
        departmentId: b.departmentId,
        designation: b.designation,
        joiningDate: b.joiningDate,
        basicSalary: new Prisma.Decimal(b.basicSalary),
        allowances: b.allowances ?? undefined,
        deductions: b.deductions ?? undefined,
        status: b.status ?? "ACTIVE",
      },
    });

    // ── auto-create a staff login with a random password
    let login: { email: string; password: string; role: string } | null = null;
    let loginSkipped: string | null = null;
    if (b.createLogin) {
      if (!employee.email) {
        loginSkipped = "No email — login not created";
      } else {
        const existing = await tx.user.findFirst({ where: { tenantId, email: employee.email } });
        if (existing) {
          loginSkipped = `A user with ${employee.email} already exists — login not created`;
        } else {
          const role = await tx.role.findFirst({
            where: { code: b.roleCode, OR: [{ tenantId }, { tenantId: null, isSystem: true }] },
          });
          const password = randomPassword();
          const user = await tx.user.create({
            data: {
              tenantId,
              userType: "STAFF",
              name: employee.name,
              email: employee.email,
              phone: employee.phone,
              passwordHash: await bcrypt.hash(password, 10),
              employeeId: employee.id,
              ...(role ? { roles: { create: [{ roleId: role.id }] } } : {}),
            },
          });
          login = { email: user.email, password, role: role?.code ?? "(no role found)" };
        }
      }
    }
    return { employee, login, loginSkipped };
  });
  res.status(201).json(result);
}));

app.put("/api/v1/employees/:id", authenticate, authorize("employee:update"), h(async (req, res) => {
  const b = parse(employeeBody.partial(), req.body);
  const employee = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!employee) throw notFound("Employee");
  res.json(await prisma.employee.update({
    where: { id: employee.id },
    data: { ...b, basicSalary: b.basicSalary !== undefined ? new Prisma.Decimal(b.basicSalary) : undefined },
  }));
}));

app.use("/api/v1/attendance", attendanceRouter);
app.use("/api/v1/leaves", leavesRouter);
app.use("/api/v1/payroll", payrollRouter);

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

const port = Number(process.env.HR_SERVICE_PORT ?? 8089);
app.listen(port, () => log.info({ port }, "hr-service listening"));
