import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { AppError, badRequest, createLogger, notFound, httpMetrics, mountOps, transactionPeriodFilters } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { Prisma, prisma, cancelExpenseDayBook } from "@fii/database";
import { TOPICS, makeEnvelope, startOutboxRelay, writeOutbox } from "@fii/kafka";

const log = createLogger("expense-service");

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

const nameBody = z.object({ name: z.string().min(2).max(100) });
const vendorBody = z.object({
  name: z.string().min(2).max(120),
  gstin: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  phone: z.string().max(15).optional(),
});

const expenseBody = z.object({
  categoryId: z.string().uuid(),
  vendorId: z.string().uuid().optional(),
  expenseDate: z.coerce.date(),
  description: z.string().min(2).max(300),
  amount: z.coerce.number().positive(), // taxable amount
  gstRate: z.coerce.number().min(0).max(28).default(0),
  isInterState: z.boolean().default(false),
  mode: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "CARD"]),
  reference: z.string().max(100).optional(),
  receiptDataUrl: z.string()
    .regex(/^data:(image\/(png|jpeg)|application\/pdf);base64,/)
    .max(700_000, "receipt must be under ~500KB")
    .optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  ...transactionPeriodFilters,
  status: z.enum(["ALL", "RECORDED", "CANCELLED"]).optional(),
});

async function activeFy(tenantId: string, date: Date) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (!fy) throw badRequest("No active financial year");
  if (fy.isLocked) throw badRequest(`FY ${fy.code} is locked`);
  if (date < fy.startDate || date > fy.endDate) throw badRequest(`Date must fall inside FY ${fy.code}`);
  return fy;
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("expense-service"));
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "expense-service" }));
mountOps(app, { name: "expense-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

// ── Categories
app.get("/api/v1/expense-categories", authenticate, authorize("expense:read"), h(async (req, res) => {
  res.json(await prisma.expenseCategory.findMany({
    where: { tenantId: req.auth!.tenantId, isActive: true },
    orderBy: { name: "asc" },
  }));
}));
app.post("/api/v1/expense-categories", authenticate, authorize("expense:create"), h(async (req, res) => {
  const b = parse(nameBody, req.body);
  try {
    res.status(201).json(await prisma.expenseCategory.create({ data: { tenantId: req.auth!.tenantId, name: b.name } }));
  } catch {
    throw badRequest("Category already exists");
  }
}));

// ── Vendors
app.get("/api/v1/expense-vendors", authenticate, authorize("expense:read"), h(async (req, res) => {
  res.json(await prisma.expenseVendor.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  }));
}));
app.post("/api/v1/expense-vendors", authenticate, authorize("expense:create"), h(async (req, res) => {
  const b = parse(vendorBody, req.body);
  try {
    res.status(201).json(await prisma.expenseVendor.create({ data: { tenantId: req.auth!.tenantId, ...b } }));
  } catch {
    throw badRequest("Vendor already exists");
  }
}));

// ── Expenses
app.get("/api/v1/expenses", authenticate, authorize("expense:read"), h(async (req, res) => {
  const q = parse(listQuery, req.query);
  const where: Prisma.ExpenseWhereInput = {
    tenantId: req.auth!.tenantId,
    ...(q.status === "ALL" ? {} : { status: q.status ?? "RECORDED" }),
    ...(q.fyCode ? { fyCode: q.fyCode } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.from || q.to ? { expenseDate: { gte: q.from, lte: q.to } } : {}),
    ...(q.search ? { description: { contains: q.search, mode: "insensitive" } } : {}),
  };
  const [items, total, sums] = await Promise.all([
    prisma.expense.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { expenseDate: "desc" },
      include: { category: { select: { name: true } }, vendor: { select: { name: true } } },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where: { AND: [where, { status: "RECORDED" }] }, _sum: { total: true, gstAmount: true } }),
  ]);
  res.json({
    items: items.map((e) => ({ ...e, receiptUrl: e.receiptUrl ? true : false, hasReceipt: !!e.receiptUrl })),
    total, page: q.page, limit: q.limit,
    sums: { total: sums._sum.total ?? 0, inputGst: sums._sum.gstAmount ?? 0 },
  });
}));

app.get("/api/v1/expenses/:id/receipt", authenticate, authorize("expense:read"), h(async (req, res) => {
  const e = await prisma.expense.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!e?.receiptUrl) throw notFound("Receipt");
  res.json({ dataUrl: e.receiptUrl });
}));

app.post("/api/v1/expenses", authenticate, authorize("expense:create"), h(async (req, res) => {
  const b = parse(expenseBody, req.body);
  const tenantId = req.auth!.tenantId;
  const fy = await activeFy(tenantId, b.expenseDate);
  const category = await prisma.expenseCategory.findFirst({ where: { id: b.categoryId, tenantId } });
  if (!category) throw notFound("Category");

  const gstAmount = Number(((b.amount * b.gstRate) / 100).toFixed(2));
  const total = Number((b.amount + gstAmount).toFixed(2));

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        tenantId,
        fyCode: fy.code,
        categoryId: b.categoryId,
        vendorId: b.vendorId,
        expenseDate: b.expenseDate,
        description: b.description,
        amount: new Prisma.Decimal(b.amount),
        gstRate: new Prisma.Decimal(b.gstRate),
        gstAmount: new Prisma.Decimal(gstAmount),
        isInterState: b.isInterState,
        total: new Prisma.Decimal(total),
        mode: b.mode,
        reference: b.reference,
        receiptUrl: b.receiptDataUrl,
        createdById: req.auth!.sub,
      },
    });
    await writeOutbox(tx, tenantId, TOPICS.EXPENSE_CREATED, makeEnvelope(tenantId, {
      expenseId: created.id,
      category: category.name,
      total: total.toFixed(2),
      mode: b.mode,
      expenseDate: b.expenseDate.toISOString(),
    }, { actorUserId: req.auth!.sub }));
    return created;
  });
  res.status(201).json(expense);
}));

app.post("/api/v1/expenses/:id/cancel", authenticate, authorize("expense:update"), h(async (req, res) => {
  const e = await prisma.expense.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!e) throw notFound("Expense");
  await activeFy(req.auth!.tenantId, e.expenseDate);
  const result = await prisma.$transaction((tx) => cancelExpenseDayBook(tx, req.auth!.tenantId, e.id, req.auth!.sub), { timeout: 30000 });
  res.json(result.expense);
}));

// ── Monthly summary (per category)
app.get("/api/v1/expenses/reports/monthly", authenticate, authorize("expense:read"), h(async (req, res) => {
  const q = parse(z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }), req.query);
  const from = new Date(Date.UTC(q.year, q.month - 1, 1));
  const to = new Date(Date.UTC(q.year, q.month, 0, 23, 59, 59));
  const rows = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: { tenantId: req.auth!.tenantId, status: "RECORDED", expenseDate: { gte: from, lte: to } },
    _sum: { total: true, gstAmount: true },
    _count: true,
  });
  const cats = await prisma.expenseCategory.findMany({ where: { id: { in: rows.map((r) => r.categoryId) } } });
  const nameById = new Map(cats.map((c) => [c.id, c.name]));
  res.json(rows.map((r) => ({
    category: nameById.get(r.categoryId) ?? "?",
    count: r._count,
    total: r._sum.total ?? 0,
    inputGst: r._sum.gstAmount ?? 0,
  })));
}));

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

const port = Number(process.env.EXPENSE_SERVICE_PORT ?? 8087);
app.listen(port, () => log.info({ port }, "expense-service listening"));
