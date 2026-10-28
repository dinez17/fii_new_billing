import { Router } from "express";
import { z } from "zod";
import { badRequest } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { Prisma, prisma } from "@fii/database";
import { h, parse, n, dayStart, dayEnd } from "./util.js";

async function fyCodeFor(tenantId: string, date: Date): Promise<string> {
  const fy = await prisma.financialYear.findFirst({
    where: { tenantId, startDate: { lte: date }, endDate: { gte: date } },
  });
  return fy?.code ?? "UNKNOWN";
}

/**
 * Opening cash for `date` = closing balance of the latest DayBookClosing before
 * `date`, plus the net of any entries between that closing and `date` (so the
 * running balance is correct even when intermediate days were never closed).
 */
async function openingBalance(tenantId: string, date: Date): Promise<number> {
  const day = dayStart(date);
  const lastClosing = await prisma.dayBookClosing.findFirst({
    where: { tenantId, closingDate: { lt: day } },
    orderBy: { closingDate: "desc" },
  });
  const since = lastClosing ? dayEnd(lastClosing.closingDate) : new Date(0);
  const agg = await prisma.dayBookEntry.groupBy({
    by: ["type"],
    where: { tenantId, entryDate: { gt: since, lt: day } },
    _sum: { amount: true },
  });
  let net = lastClosing ? n(lastClosing.closingBalance) : 0;
  for (const g of agg) net += (g.type === "CASH_IN" ? 1 : -1) * n(g._sum.amount);
  return Math.round(net * 100) / 100;
}

async function computeDay(tenantId: string, date: Date) {
  const from = dayStart(date);
  const to = dayEnd(date);
  const [entries, opening] = await Promise.all([
    prisma.dayBookEntry.findMany({ where: { tenantId, entryDate: { gte: from, lte: to } }, orderBy: { createdAt: "asc" } }),
    openingBalance(tenantId, date),
  ]);
  let cashIn = 0, cashOut = 0;
  for (const e of entries) (e.type === "CASH_IN" ? (cashIn += n(e.amount)) : (cashOut += n(e.amount)));
  cashIn = Math.round(cashIn * 100) / 100;
  cashOut = Math.round(cashOut * 100) / 100;
  const closing = Math.round((opening + cashIn - cashOut) * 100) / 100;
  const existingClose = await prisma.dayBookClosing.findFirst({ where: { tenantId, closingDate: from } });
  return { date: from, opening, cashIn, cashOut, closing, entries, closed: !!existingClose };
}

export const dayBookRouter = Router();
dayBookRouter.use(authenticate);

export async function computeDayBookPeriod(tenantId: string, q: { fyCode?: string; from?: Date; to?: Date; page?: number; limit?: number }) {
  const fy = q.fyCode ? await prisma.financialYear.findFirst({ where: { tenantId, code: q.fyCode } }) : await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (q.fyCode && !fy) throw badRequest("Financial year not found");
  if (!q.from && !fy) throw badRequest("Set an active financial year or choose a from date");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = new Date(["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-"));
  const from = dayStart(q.from ?? fy!.startDate), to = dayEnd(q.to ?? today);
  if (to < from) throw badRequest("To date must be on/after from date");
  const page = q.page ?? 1, limit = q.limit ?? 20;
  const where = { tenantId, ...(fy ? { fyCode: fy.code } : {}), entryDate: { gte: from, lte: to } };
  const [entries, total, sums, opening] = await Promise.all([
    prisma.dayBookEntry.findMany({ where, orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
    prisma.dayBookEntry.count({ where }),
    prisma.dayBookEntry.groupBy({ by: ["type"], where, _sum: { amount: true } }),
    openingBalance(tenantId, from),
  ]);
  const cashIn = n(sums.find((row) => row.type === "CASH_IN")?._sum.amount), cashOut = n(sums.find((row) => row.type === "CASH_OUT")?._sum.amount);
  return { from, to, fyCode: fy?.code, opening, cashIn, cashOut, closing: Math.round((opening + cashIn - cashOut) * 100) / 100, entries, total, page, limit, closed: false };
}

/** Day sheet: opening, entries, cash in/out and computed closing for a date. */
dayBookRouter.get("/", authorize("day_book:read"), h(async (req, res) => {
  const q = parse(z.object({ date: z.coerce.date().optional(), fyCode: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  res.json(q.date ? await computeDay(req.auth!.tenantId, q.date) : await computeDayBookPeriod(req.auth!.tenantId, q));
}));

const manualBody = z.object({
  date: z.coerce.date(),
  type: z.enum(["CASH_IN", "CASH_OUT"]),
  mode: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "CARD"]).default("CASH"),
  amount: z.coerce.number().positive(),
  narration: z.string().min(2).max(300),
});

dayBookRouter.post("/manual-entry", authorize("day_book:create"), h(async (req, res) => {
  const b = parse(manualBody, req.body);
  const tenantId = req.auth!.tenantId;
  const day = dayStart(b.date);
  const closed = await prisma.dayBookClosing.findFirst({ where: { tenantId, closingDate: day } });
  if (closed) throw badRequest("Day is already closed — reopen not supported");
  res.status(201).json(await prisma.dayBookEntry.create({
    data: {
      tenantId,
      fyCode: await fyCodeFor(tenantId, day),
      entryDate: day,
      type: b.type,
      source: "MANUAL",
      mode: b.mode,
      amount: new Prisma.Decimal(b.amount),
      narration: b.narration,
      createdById: req.auth!.sub,
    },
  }));
}));

/** Freeze a day: writes DayBookClosing with the computed balances. */
dayBookRouter.post("/close", authorize("day_book:update"), h(async (req, res) => {
  const b = parse(z.object({ date: z.coerce.date() }), req.body);
  const tenantId = req.auth!.tenantId;
  if (dayStart(b.date) > dayStart(new Date())) throw badRequest("Cannot close a future day");
  const closing = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const day = await computeDay(tenantId, b.date);
    if (day.closed) throw badRequest("Day already closed");
    return tx.dayBookClosing.create({
    data: {
      tenantId,
      closingDate: day.date,
      openingBalance: new Prisma.Decimal(day.opening),
      totalCashIn: new Prisma.Decimal(day.cashIn),
      totalCashOut: new Prisma.Decimal(day.cashOut),
      closingBalance: new Prisma.Decimal(day.closing),
      closedById: req.auth!.sub,
    },
    });
  });
  res.status(201).json(closing);
}));

// ── Party ledger (customer / supplier) with running balance
export const ledgerRouter = Router();
ledgerRouter.use(authenticate);

ledgerRouter.get("/", authorize("ledger:read"), h(async (req, res) => {
  const q = parse(z.object({
    partyType: z.enum(["CUSTOMER", "SUPPLIER"]),
    partyId: z.string().uuid(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }), req.query);
  const tenantId = req.auth!.tenantId;

  // opening = net of all entries strictly before `from`
  let opening = 0;
  if (q.from) {
    const prior = await prisma.ledgerEntry.aggregate({
      where: { tenantId, partyType: q.partyType, partyId: q.partyId, entryDate: { lt: dayStart(q.from) } },
      _sum: { debit: true, credit: true },
    });
    opening = Math.round((n(prior._sum.debit) - n(prior._sum.credit)) * 100) / 100;
  }
  const rows = await prisma.ledgerEntry.findMany({
    where: {
      tenantId, partyType: q.partyType, partyId: q.partyId,
      ...(q.from || q.to ? { entryDate: { ...(q.from ? { gte: dayStart(q.from) } : {}), ...(q.to ? { lte: dayEnd(q.to) } : {}) } } : {}),
    },
    orderBy: { entryDate: "asc" },
  });
  let balance = opening;
  const entries = rows.map((r) => {
    balance = Math.round((balance + n(r.debit) - n(r.credit)) * 100) / 100;
    return { ...r, balance };
  });
  res.json({ opening, closing: balance, entries });
}));
