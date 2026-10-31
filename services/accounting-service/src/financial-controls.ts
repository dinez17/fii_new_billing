import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "@fii/auth";
import { badRequest, notFound } from "@fii/common";
import { Prisma, prisma } from "@fii/database";
import { h, parse } from "./util.js";

const money = z.coerce.number().finite().min(0).max(999999999999.99).multipleOf(0.01);
export const journalBody = z.object({ entryDate: z.coerce.date(), narration: z.string().trim().min(10).max(500),
  lines: z.array(z.object({ accountId: z.string().uuid(), debit: money.default(0), credit: money.default(0) })).min(2).max(100) });

export async function postJournal(tenantId: string, actorId: string, input: z.infer<typeof journalBody>, reversalOf?: string) {
  return prisma.$transaction(async tx => {
    const date = new Date(input.entryDate.toISOString().slice(0,10));
    await tx.$queryRaw`SELECT id FROM "FinancialYear" WHERE "tenantId" = ${tenantId} AND "startDate" <= ${date} AND "endDate" >= ${date} FOR SHARE`;
    const fy = await tx.financialYear.findFirst({ where: { tenantId, startDate: { lte: date }, endDate: { gte: date } } });
    if (!fy || !fy.isActive || fy.isLocked) throw badRequest("Choose a date in the active unlocked financial year");
    const ids = [...new Set(input.lines.map(l => l.accountId))];
    const accounts = await tx.financialAccount.findMany({ where: { tenantId, id: { in: ids }, isActive: true } });
    if (accounts.length !== ids.length) throw badRequest("An account is inactive or belongs to another tenant");
    const total = input.lines.reduce((s,l) => s.add(l.debit).sub(l.credit), new Prisma.Decimal(0));
    if (!total.isZero() || input.lines.some(l => (l.debit > 0) === (l.credit > 0))) throw badRequest("Every line must have one positive side and total debits must equal credits");
    if (reversalOf) {
      await tx.$queryRaw`SELECT id FROM "JournalEntry" WHERE "tenantId" = ${tenantId} AND id = ${reversalOf} FOR UPDATE`;
      const original = await tx.journalEntry.findFirst({ where: { id: reversalOf, tenantId } });
      if (!original || original.source !== "MANUAL" || original.reversalOf || await tx.journalEntry.findFirst({ where: { tenantId, reversalOf } })) throw badRequest("Journal cannot be reversed again");
    }
    const journal = await tx.journalEntry.create({ data: { tenantId, fyCode: fy.code, entryDate: date, narration: input.narration,
      createdById: actorId, reversalOf, source: reversalOf ? "REVERSAL" : "MANUAL", lines: { create: input.lines.map(l => ({ ...l, tenantId })) } }, include: { lines: true } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "JOURNAL_POSTED", entity: "JournalEntry", entityId: journal.id,
      after: { narration: input.narration, reversalOf: reversalOf ?? null, lineCount: input.lines.length } } });
    return journal;
  });
}

export async function trialBalance(tenantId: string, fyCode?: string) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, ...(fyCode ? { code: fyCode } : { isActive: true }) } });
  if (!fy) throw badRequest("Financial year not found");
  return prisma.$transaction(async tx => {
    const accounts = await tx.financialAccount.findMany({ where: { tenantId }, orderBy: { code: "asc" } });
    const openings = await tx.journalLine.groupBy({ by: ["accountId"], where: { tenantId, journal: { tenantId, entryDate: { lt: fy.startDate } } }, _sum: { debit: true, credit: true } });
    const periods = await tx.journalLine.groupBy({ by: ["accountId"], where: { tenantId, journal: { tenantId, entryDate: { gte: fy.startDate, lte: fy.endDate } } }, _sum: { debit: true, credit: true } });
    const items = [];
    for (const account of accounts) {
      const opening = openings.find(o => o.accountId === account.id) ?? { _sum: { debit: null, credit: null } };
      const period = periods.find(o => o.accountId === account.id) ?? { _sum: { debit: null, credit: null } };
      const balance = new Prisma.Decimal(opening._sum.debit ?? 0).sub(opening._sum.credit ?? 0);
      const closing = balance.add(period._sum.debit ?? 0).sub(period._sum.credit ?? 0);
      items.push({ ...account, opening: balance.toFixed(2), debit: (period._sum.debit ?? new Prisma.Decimal(0)).toFixed(2),
        credit: (period._sum.credit ?? new Prisma.Decimal(0)).toFixed(2), closing: closing.toFixed(2) });
    }
    return { fyCode: fy.code, items, difference: items.reduce((s,a) => s.add(a.closing), new Prisma.Decimal(0)).toFixed(2),
      scope: "Automatic source journals plus manual journals. Reconcile older source documents and verified opening balances for complete coverage." };
  }, { isolationLevel: "RepeatableRead" });
}

export const financialControlsRouter = Router();
financialControlsRouter.use(authenticate);
const yearChecks = ["customerBalances", "supplierBalances", "cashAndBanks", "stock", "tdsAndTaxes", "legacyHolds", "profitAndOpeningBalances"] as const;
export async function yearEndSnapshot(tx: Prisma.TransactionClient, tenantId: string, fyCode: string) {
  const fy = await tx.financialYear.findFirst({ where: { tenantId, code: fyCode } });
  if (!fy) throw notFound("Financial year");
  const fingerprints: Record<string,string> = {};
  for (const table of ["Invoice", "Payment", "CreditNote", "DebitNote", "PurchaseInvoice", "SupplierPayment", "Expense", "LedgerEntry", "DayBookEntry", "JournalEntry"]) {
    const rows = await tx.$queryRawUnsafe<Array<{ hash: string }>>(`SELECT md5(COALESCE(string_agg(md5(to_jsonb(r)::text), ',' ORDER BY id),'')) AS hash FROM "${table}" r WHERE "tenantId" = $1 AND "fyCode" = $2`, tenantId, fyCode);
    fingerprints[table] = rows[0]!.hash;
  }
  for (const table of ["Customer", "Supplier", "Product", "JournalLine", "BankStatementLine", "TdsClearing", "ReceivableWriteOff"]) {
    const rows = await tx.$queryRawUnsafe<Array<{ hash: string }>>(`SELECT md5(COALESCE(string_agg(md5(to_jsonb(r)::text), ',' ORDER BY id),'')) AS hash FROM "${table}" r WHERE "tenantId" = $1`, tenantId);
    fingerprints[table] = rows[0]!.hash;
  }
  const held = await tx.legacyRecord.count({ where: { tenantId, status: "REVIEW", sourceTable: { in: ["user_bills", "user_purchase_bills"] } } });
  const unmatched = await tx.bankStatementLine.count({ where: { tenantId, statementDate: { gte: fy.startDate, lte: fy.endDate }, journalLineId: null } });
  const pendingEvents = await tx.outboxEvent.count({ where: { tenantId, publishedAt: null } });
  const profitBasis = await tx.setting.findUnique({ where: { tenantId_group_key: { tenantId, group: "ACCOUNTING", key: "profitCarryForwardStart" } } });
  const signature = createHash("sha256").update(JSON.stringify({ fingerprints, held, unmatched, pendingEvents, profitBasis: profitBasis?.value })).digest("hex");
  return { financialYear: fy, signature, heldDocuments: held, unmatchedBankLines: unmatched, pendingEvents, profitBasis: profitBasis?.value ?? null };
}
financialControlsRouter.get("/year-end/:fyCode", authorize("report:read"), h(async (req,res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await prisma.$transaction(async tx => {
    const snapshot = await yearEndSnapshot(tx, req.auth!.tenantId, req.params.fyCode);
    const saved = await tx.setting.findUnique({ where: { tenantId_group_key: { tenantId: req.auth!.tenantId, group: "YEAR_END_REVIEW", key: req.params.fyCode } } });
    const review = saved ? JSON.parse(saved.value) : null;
    return { ...snapshot, review, needsReview: !review || review.signature !== snapshot.signature, checks: yearChecks };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 }));
}));
financialControlsRouter.post("/year-end/:fyCode/review", authorize("financial_year:update"), h(async (req,res) => {
  const b = parse(z.object({ note: z.string().trim().min(20).max(1000), signature: z.string().regex(/^[a-f0-9]{64}$/), checks: z.record(z.string(), z.boolean()) }), req.body);
  if (yearChecks.some(key => !b.checks[key])) throw badRequest("Complete every reconciliation checklist item");
  res.json(await prisma.$transaction(async tx => {
    const snapshot = await yearEndSnapshot(tx, req.auth!.tenantId, req.params.fyCode);
    if (snapshot.signature !== b.signature) throw badRequest("Financial records changed; refresh and review again");
    if (snapshot.pendingEvents) throw badRequest("Wait for background financial posting before saving the review");
    const value = { ...b, reviewedBy: req.auth!.sub, reviewedAt: new Date().toISOString(), heldDocuments: snapshot.heldDocuments, unmatchedBankLines: snapshot.unmatchedBankLines };
    const key = { tenantId: req.auth!.tenantId, group: "YEAR_END_REVIEW", key: req.params.fyCode };
    await tx.setting.upsert({ where: { tenantId_group_key: key }, create: { ...key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
    await tx.auditLog.create({ data: { tenantId: req.auth!.tenantId, userId: req.auth!.sub, action: "YEAR_END_REVIEW_SAVED", entity: "FinancialYear", entityId: snapshot.financialYear.id, after: value } });
    return { saved: true, message: "Review saved. Historical records and profit carry-forward basis are unchanged. Financial-year locking remains a separate action in Settings." };
  }, { isolationLevel: "Serializable", timeout: 30000 }));
}));
financialControlsRouter.get("/accounts", authorize("report:read"), h(async (req,res) => {
  res.json(await prisma.financialAccount.findMany({ where: { tenantId: req.auth!.tenantId }, orderBy: { code: "asc" } }));
}));
financialControlsRouter.post("/accounts", authorize("settings:update"), h(async (req,res) => {
  const b = parse(z.object({ code: z.string().trim().regex(/^[A-Z0-9_-]{1,30}$/), name: z.string().trim().min(2).max(100),
    type: z.enum(["ASSET","LIABILITY","EQUITY","INCOME","EXPENSE"]), isMoneyAccount: z.boolean().default(false) }), req.body);
  if (b.isMoneyAccount && b.type !== "ASSET") throw badRequest("Cash and bank accounts must be assets");
  res.status(201).json(await prisma.$transaction(async tx => {
    if(b.code.startsWith("SYS_"))throw badRequest("SYS_ codes are reserved for automatic accounting");
    const account = await tx.financialAccount.create({ data: { ...b, tenantId: req.auth!.tenantId } });
    await tx.auditLog.create({ data: { tenantId: req.auth!.tenantId, userId: req.auth!.sub, action: "FINANCIAL_ACCOUNT_CREATED", entity: "FinancialAccount", entityId: account.id, after: b } });
    return account;
  }));
}));
financialControlsRouter.get("/trial-balance", authorize("report:read"), h(async (req,res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await trialBalance(req.auth!.tenantId, parse(z.object({ fyCode: z.string().optional() }), req.query).fyCode));
}));
financialControlsRouter.get("/journals", authorize("report:read"), h(async (req,res) => {
  const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  const where = { tenantId: req.auth!.tenantId };
  const [items,total] = await prisma.$transaction([prisma.journalEntry.findMany({ where, orderBy: [{ entryDate: "desc" }, { id: "asc" }], skip: (q.page-1)*q.limit, take: q.limit, include: { lines: { include: { account: true } } } }), prisma.journalEntry.count({ where })]);
  res.json({ items,total,...q });
}));
financialControlsRouter.post("/journals", authorize("day_book:create"), h(async (req,res) => {
  res.status(201).json(await postJournal(req.auth!.tenantId, req.auth!.sub, parse(journalBody, req.body)));
}));
financialControlsRouter.post("/journals/:id/reverse", authorize("day_book:update"), h(async (req,res) => {
  const b = parse(z.object({ entryDate: z.coerce.date(), reason: z.string().trim().min(10).max(500) }), req.body);
  const original = await prisma.journalEntry.findFirst({ where: { tenantId: req.auth!.tenantId, id: req.params.id }, include: { lines: true } });
  if (!original) throw notFound("Journal");
  res.status(201).json(await postJournal(req.auth!.tenantId, req.auth!.sub, { entryDate: b.entryDate, narration: b.reason,
    lines: original.lines.map(l => ({ accountId: l.accountId, debit: Number(l.credit), credit: Number(l.debit) })) }, original.id));
}));

// CSV uploads are normalized by the UI into these rows; no bank format is guessed.
financialControlsRouter.post("/bank-statements", authorize("day_book:create"), h(async (req,res) => {
  const b = parse(z.object({ accountId: z.string().uuid(), rows: z.array(z.object({ date: z.coerce.date(), reference: z.string().trim().min(1).max(100), narration: z.string().max(500), debit: money, credit: money })).min(1).max(1000) }), req.body);
  const tenantId = req.auth!.tenantId;
  const result = await prisma.$transaction(async tx => {
    const account = await tx.financialAccount.findFirst({ where: { tenantId, id: b.accountId, isMoneyAccount: true, isActive: true } });
    if (!account) throw notFound("Cash/bank account");
    if (b.rows.some(r => (r.debit > 0) === (r.credit > 0))) throw badRequest("Each statement line needs one positive debit or credit");
    const data = b.rows.map(r => ({ tenantId, accountId: b.accountId, statementDate: r.date, reference: r.reference, narration: r.narration, debit: r.debit, credit: r.credit,
      importKey: createHash("sha256").update(JSON.stringify([r.date.toISOString().slice(0,10), r.reference, r.debit, r.credit, r.narration])).digest("hex") }));
    const imported = await tx.bankStatementLine.createMany({ data, skipDuplicates: true });
    await tx.auditLog.create({ data: { tenantId, userId: req.auth!.sub, action: "BANK_STATEMENT_IMPORTED", entity: "FinancialAccount", entityId: b.accountId, after: { imported: imported.count, submitted: data.length } } });
    return { imported: imported.count, duplicates: data.length-imported.count };
  });
  res.json(result);
}));
financialControlsRouter.get("/bank-statements", authorize("report:read"), h(async (req,res) => {
  const q = parse(z.object({ accountId: z.string().uuid(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  const where = { tenantId: req.auth!.tenantId, accountId: q.accountId };
  const [items,total] = await prisma.$transaction([prisma.bankStatementLine.findMany({ where, skip: (q.page-1)*q.limit, take: q.limit, orderBy: [{ statementDate: "desc" }, { id: "asc" }] }), prisma.bankStatementLine.count({ where })]);
  res.json({ items,total,...q });
}));
financialControlsRouter.post("/bank-statements/:id/match", authorize("day_book:update"), h(async (req,res) => {
  const b = parse(z.object({ journalLineId: z.string().uuid().nullable() }), req.body), tenantId = req.auth!.tenantId;
  res.json(await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "BankStatementLine" WHERE "tenantId" = ${tenantId} AND id = ${req.params.id} FOR UPDATE`;
    const row = await tx.bankStatementLine.findFirst({ where: { tenantId, id: req.params.id } });
    if (!row) throw notFound("Statement line");
    if (b.journalLineId) {
      const line = await tx.journalLine.findFirst({ where: { tenantId, id: b.journalLineId, accountId: row.accountId } });
      // Bank debit = withdrawal (credit in our books); bank credit = receipt (debit).
      if (!line || !line.debit.eq(row.credit) || !line.credit.eq(row.debit)) throw badRequest("Account, direction and amount must match the journal line");
    }
    const changed = await tx.bankStatementLine.update({ where: { id: row.id }, data: { journalLineId: b.journalLineId, reconciledById: b.journalLineId ? req.auth!.sub : null, reconciledAt: b.journalLineId ? new Date() : null } });
    await tx.auditLog.create({ data: { tenantId, userId: req.auth!.sub, action: "BANK_STATEMENT_MATCH_CHANGED", entity: "BankStatementLine", entityId: row.id, before: { journalLineId: row.journalLineId }, after: b } });
    return changed;
  }));
}));
financialControlsRouter.get("/bank-statements/:id/candidates", authorize("report:read"), h(async (req,res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.bankStatementLine.findFirst({ where: { tenantId, id: req.params.id } });
  if (!row) throw notFound("Statement line");
  res.json(await prisma.journalLine.findMany({ where: { tenantId, accountId: row.accountId, debit: row.credit, credit: row.debit, statement: null },
    include: { journal: { select: { entryDate: true, narration: true } } }, orderBy: { id: "asc" }, take: 100 }));
}));
