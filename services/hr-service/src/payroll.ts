import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { badRequest, notFound } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { moneyAccount, syncSourceJournal, Prisma, prisma } from "@fii/database";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";
import { streamPayslipPdf, payslipFileName } from "@fii/pdf";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

const genBody = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  force: z.boolean().default(false), // regenerate a GENERATED (unpaid) run
});

const markPaidBody = z.object({
  financialAccountId: z.string().uuid().nullable().optional(),
  mode: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI"]).default("BANK_TRANSFER"),
});

type NameAmount = { name: string; amount: number };
const sumJson = (v: Prisma.JsonValue | null): number =>
  Array.isArray(v) ? (v as unknown as NameAmount[]).reduce((s, x) => s + Number(x.amount || 0), 0) : 0;

export const payrollRouter = Router();
payrollRouter.use(authenticate);

/**
 * Payroll math (per ACTIVE employee):
 *   daysInMonth  = calendar days
 *   sundays      = # of Sundays in the month   (Sunday is the weekly off)
 *   workingDays  = daysInMonth − sundays
 *   lopDays      = ABSENT + HALF_DAY×0.5   (LEAVE/HOLIDAY/WEEK_OFF are paid)
 *   perDay       = basic / workingDays      (a full month worked = full basic)
 *   leaveDeduction = perDay × lopDays
 *   otPay        = overtimeHours × (basic / 240)   (30d × 8h working month)
 *   net = basic + allowances − deductions − leaveDeduction + otPay
 */
payrollRouter.post("/generate", authorize("payroll:create"), h(async (req, res) => {
  const b = parse(genBody, req.body);
  const tenantId = req.auth!.tenantId;

  const fy = await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (!fy) throw badRequest("No active financial year");

  const existing = await prisma.payrollRun.findFirst({ where: { tenantId, year: b.year, month: b.month } });
  if (existing) {
    const paid = await prisma.payslip.count({ where: { payrollRunId: existing.id, status: "PAID" } });
    if (paid > 0) throw badRequest("Payroll already has paid payslips — cannot regenerate");
    if (!b.force) throw badRequest("Payroll already generated for this month — use force to regenerate");
    await prisma.$transaction([
      prisma.payslip.deleteMany({ where: { payrollRunId: existing.id } }),
      prisma.payrollRun.delete({ where: { id: existing.id } }),
    ]);
  }

  const from = new Date(Date.UTC(b.year, b.month - 1, 1));
  const to = new Date(Date.UTC(b.year, b.month, 0));
  const daysInMonth = to.getUTCDate();

  // Sunday is the weekly off — pay is spread over working days only, so a full
  // month worked (Mon–Sat) earns the full basic.
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(Date.UTC(b.year, b.month - 1, d)).getUTCDay() === 0) sundays++;
  }
  const workingDays = daysInMonth - sundays;

  const employees = await prisma.employee.findMany({ where: { tenantId, status: "ACTIVE" } });
  if (employees.length === 0) throw badRequest("No active employees");

  const attendance = await prisma.attendance.groupBy({
    by: ["employeeId", "status"],
    where: { tenantId, date: { gte: from, lte: to } },
    _count: true,
    _sum: { overtimeHours: true },
  });
  const attByEmp = new Map<string, { counts: Record<string, number>; ot: number }>();
  for (const r of attendance) {
    const rec = attByEmp.get(r.employeeId) ?? { counts: {}, ot: 0 };
    rec.counts[r.status] = r._count;
    rec.ot += Number(r._sum.overtimeHours ?? 0);
    attByEmp.set(r.employeeId, rec);
  }

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollRun.create({
      data: { tenantId, fyCode: fy.code, year: b.year, month: b.month, status: "GENERATED", generatedAt: new Date(), createdById: req.auth!.sub },
    });

    for (const emp of employees) {
      const att = attByEmp.get(emp.id) ?? { counts: {}, ot: 0 };
      const absent = att.counts.ABSENT ?? 0;
      const halfDay = att.counts.HALF_DAY ?? 0;
      const present = (att.counts.PRESENT ?? 0) + halfDay * 0.5;
      const leaveDays = att.counts.LEAVE ?? 0;
      const lopDays = absent + halfDay * 0.5;

      const basic = Number(emp.basicSalary);
      const allowances = sumJson(emp.allowances);
      const deductions = sumJson(emp.deductions);
      const perDay = basic / workingDays;
      const leaveDeduction = Number((perDay * lopDays).toFixed(2));
      const otPay = Number((att.ot * (basic / 240)).toFixed(2));
      const net = Number((basic + allowances - deductions - leaveDeduction + otPay).toFixed(2));

      await tx.payslip.create({
        data: {
          tenantId,
          payrollRunId: created.id,
          employeeId: emp.id,
          basicSalary: new Prisma.Decimal(basic),
          allowances: emp.allowances ?? undefined,
          deductions: emp.deductions ?? undefined,
          totalAllowances: new Prisma.Decimal(allowances),
          totalDeductions: new Prisma.Decimal(deductions),
          presentDays: new Prisma.Decimal(present),
          leaveDays: new Prisma.Decimal(leaveDays),
          lopDays: new Prisma.Decimal(lopDays),
          leaveDeduction: new Prisma.Decimal(leaveDeduction),
          overtimeHours: new Prisma.Decimal(att.ot),
          overtimePay: new Prisma.Decimal(otPay),
          netSalary: new Prisma.Decimal(Math.max(0, net)),
          status: "GENERATED",
        },
      });
    }

    await writeOutbox(tx, tenantId, TOPICS.PAYROLL_GENERATED, makeEnvelope(tenantId, {
      payrollRunId: created.id, year: b.year, month: b.month, employees: employees.length,
    }, { actorUserId: req.auth!.sub }));

    return created;
  });

  res.status(201).json(run);
}));

payrollRouter.get("/runs", authorize("payroll:read"), h(async (req, res) => {
  const runs = await prisma.payrollRun.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 24,
    include: { _count: { select: { payslips: true } } },
  });
  res.json(runs);
}));

payrollRouter.get("/runs/:id", authorize("payroll:read"), h(async (req, res) => {
  const run = await prisma.payrollRun.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      payslips: {
        include: { employee: { select: { code: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!run) throw notFound("Payroll run");
  res.json(run);
}));

/** Payslip PDF (streamed). */
payrollRouter.get("/payslips/:id/pdf", authorize("payroll:read"), h(async (req, res) => {
  await streamPayslipPdf(req.auth!.tenantId, req.params.id, res, (p) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${payslipFileName(p)}.pdf"`);
  });
}));

/** Mark paid → auto expense entry (Salaries) + salary.paid event for the day book. */
payrollRouter.post("/payslips/:id/mark-paid", authorize("payroll:update"), h(async (req, res) => {
  const b = parse(markPaidBody, req.body);
  const tenantId = req.auth!.tenantId;
  const slip = await prisma.payslip.findFirst({
    where: { id: req.params.id, tenantId },
    include: { employee: { select: { name: true, code: true } }, payrollRun: true },
  });
  if (!slip) throw notFound("Payslip");
  if (slip.status === "PAID") throw badRequest("Already paid");

  const monthName = new Date(Date.UTC(slip.payrollRun.year, slip.payrollRun.month - 1, 1))
    .toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payslip" WHERE "tenantId"=${tenantId} AND id=${slip.id} FOR UPDATE`;
    if((await tx.payslip.findFirstOrThrow({where:{tenantId,id:slip.id}})).status==="PAID")throw badRequest("Already paid");
    const paidAt=new Date(), paidDay=new Date(paidAt.toISOString().slice(0,10));
    await tx.$queryRaw`SELECT id FROM "FinancialYear" WHERE "tenantId"=${tenantId} AND "startDate"<=${paidDay} AND "endDate">=${paidDay} FOR SHARE`;
    const paymentYear=await tx.financialYear.findFirst({where:{tenantId,startDate:{lte:paidDay},endDate:{gte:paidDay},isActive:true,isLocked:false}});
    if(!paymentYear)throw badRequest("Salary payment requires an active unlocked financial year for today");
    const accountId = await moneyAccount(tx,tenantId,b.financialAccountId,b.mode);
    await tx.payslip.update({
      where: { id: slip.id },
      data: { status: "PAID", paidAt, paidMode: b.mode, financialAccountId: accountId },
    });

    // auto expense entry under "Salaries"
    const category = await tx.expenseCategory.upsert({
      where: { tenantId_name: { tenantId, name: "Salaries" } },
      create: { tenantId, name: "Salaries" },
      update: {},
    });
    const expense = await tx.expense.create({
      data: {
        tenantId,
        fyCode: paymentYear.code,
        categoryId: category.id, payslipId: slip.id,
        expenseDate: paidAt,
        description: `Salary — ${slip.employee.name} (${slip.employee.code}) — ${monthName}`,
        amount: slip.netSalary,
        gstRate: new Prisma.Decimal(0),
        gstAmount: new Prisma.Decimal(0),
        total: slip.netSalary,
        mode: b.mode, financialAccountId: accountId,
        createdById: req.auth!.sub,
      },
    });

    await syncSourceJournal(tx,tenantId,"EXPENSE",expense.id,req.auth!.sub);
    await writeOutbox(tx, tenantId, TOPICS.SALARY_PAID, makeEnvelope(tenantId, {
      payslipId: slip.id,
      employeeName: slip.employee.name,
      amount: Number(slip.netSalary).toFixed(2),
      mode: b.mode,
      month: monthName,
    }, { actorUserId: req.auth!.sub }));
  });

  res.json({ ok: true });
}));
