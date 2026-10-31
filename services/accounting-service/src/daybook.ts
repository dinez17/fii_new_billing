import { Router } from "express";
import { z } from "zod";
import { badRequest } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { moneyAccount, syncSourceJournal, Prisma, prisma } from "@fii/database";
import { h, parse, n, dayStart, dayEnd } from "./util.js";

import { computeDayBookDay, computeDayBookPeriod, saveDayBookClosing } from "./daybook-balances.js";
export { computeDayBookPeriod } from "./daybook-balances.js";
export const dayBookRouter = Router();
dayBookRouter.use(authenticate);
dayBookRouter.get("/", authorize("day_book:read"), h(async (req, res) => {
  const q = parse(z.object({ date: z.coerce.date().optional(), fyCode: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  res.setHeader("Cache-Control", "no-store");
  res.json(q.date ? await computeDayBookDay(req.auth!.tenantId, q.date) : await computeDayBookPeriod(req.auth!.tenantId, q));
}));

const manualBody = z.object({
  date: z.coerce.date(),
  type: z.enum(["CASH_IN", "CASH_OUT"]),
  financialAccountId: z.string().uuid().nullable().optional(),
  mode: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "CARD"]).default("CASH"),
  amount: z.coerce.number().positive(),
  narration: z.string().min(2).max(300),
});

dayBookRouter.post("/manual-entry", authorize("day_book:create"), h(async (req, res) => {
  const b = parse(manualBody, req.body);
  const tenantId = req.auth!.tenantId;
  const day = dayStart(b.date);
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, startDate: { lte: day }, endDate: { gte: day } } });
  if (!fy || fy.isLocked) throw badRequest("Choose a date in an unlocked financial year");
  res.status(201).json(await prisma.$transaction(async tx => { const accountId = await moneyAccount(tx,tenantId,b.financialAccountId,b.mode); const entry = await tx.dayBookEntry.create({
    data: {
      tenantId,
      fyCode: fy.code,
      entryDate: day,
      type: b.type,
      source: "MANUAL", financialAccountId: accountId,
      mode: b.mode,
      amount: new Prisma.Decimal(b.amount),
      narration: b.narration,
      createdById: req.auth!.sub,
    },
  }); await syncSourceJournal(tx,tenantId,"MANUAL_CASH",entry.id,req.auth!.sub); return entry; }));
}));

/** Save a reconciliation snapshot; later/backdated changes are flagged for review. */
dayBookRouter.post("/close", authorize("day_book:update"), h(async (req, res) => {
  const b = parse(z.object({ date: z.coerce.date(), note: z.string().trim().min(5).max(500) }), req.body);
  res.status(201).json(await saveDayBookClosing(req.auth!.tenantId, req.auth!.sub, b.date, b.note));
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
