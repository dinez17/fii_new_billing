import { Router } from "express";
import { z } from "zod";
import { notFound } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { Prisma, prisma, computeTallyPnl, computeBalanceSheet } from "@fii/database";
import { h, parse, n, dayStart, dayEnd, dateRange } from "./util.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const rangeWhere = (from: Date, to: Date) => ({ gte: dayStart(from), lte: dayEnd(to) });

/** Sales register — invoices in range (excl. cancelled). */
reportsRouter.get("/sales", authorize("report:read"), h(async (req, res) => {
  const q = parse(dateRange, req.query);
  const tenantId = req.auth!.tenantId;
  const where: Prisma.InvoiceWhereInput = {
    tenantId, status: { not: "CANCELLED" }, invoiceDate: rangeWhere(q.from, q.to),
  };
  const [rows, agg] = await Promise.all([
    prisma.invoice.findMany({
      where, orderBy: { invoiceDate: "asc" }, take: 2000,
      select: {
        id: true, invoiceNumber: true, invoiceDate: true, gstTreatment: true,
        taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true, amountPaid: true, status: true,
        customer: { select: { name: true, gstin: true } },
      },
    }),
    prisma.invoice.aggregate({ where, _sum: { taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true, amountPaid: true }, _count: true }),
  ]);
  res.json({
    range: { from: q.from, to: q.to },
    summary: {
      count: agg._count,
      taxableValue: n(agg._sum.taxableValue), cgst: n(agg._sum.cgst), sgst: n(agg._sum.sgst),
      igst: n(agg._sum.igst), grandTotal: n(agg._sum.grandTotal), collected: n(agg._sum.amountPaid),
      outstanding: Math.round((n(agg._sum.grandTotal) - n(agg._sum.amountPaid)) * 100) / 100,
    },
    rows,
  });
}));

/** Purchase register — purchase invoices in range. */
reportsRouter.get("/purchases", authorize("report:read"), h(async (req, res) => {
  const q = parse(dateRange, req.query);
  const tenantId = req.auth!.tenantId;
  const where: Prisma.PurchaseInvoiceWhereInput = { tenantId, invoiceDate: rangeWhere(q.from, q.to) };
  const [rows, agg] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where, orderBy: { invoiceDate: "asc" }, take: 2000,
      select: {
        id: true, ourNumber: true, billNumber: true, invoiceDate: true,
        taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true, amountPaid: true, status: true,
        supplier: { select: { name: true, gstin: true } },
      },
    }),
    prisma.purchaseInvoice.aggregate({ where, _sum: { taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true, amountPaid: true }, _count: true }),
  ]);
  res.json({
    range: { from: q.from, to: q.to },
    summary: {
      count: agg._count,
      taxableValue: n(agg._sum.taxableValue), inputCgst: n(agg._sum.cgst), inputSgst: n(agg._sum.sgst),
      inputIgst: n(agg._sum.igst), grandTotal: n(agg._sum.grandTotal), paid: n(agg._sum.amountPaid),
      payable: Math.round((n(agg._sum.grandTotal) - n(agg._sum.amountPaid)) * 100) / 100,
    },
    rows,
  });
}));

/** Collection report — successful payments in range. */
reportsRouter.get("/collections", authorize("report:read"), h(async (req, res) => {
  const q = parse(dateRange, req.query);
  const tenantId = req.auth!.tenantId;
  const where: Prisma.PaymentWhereInput = { tenantId, status: "SUCCESS", paymentDate: rangeWhere(q.from, q.to) };
  const [rows, byMode] = await Promise.all([
    prisma.payment.findMany({
      where, orderBy: { paymentDate: "asc" }, take: 2000,
      select: { id: true, paymentDate: true, amount: true, mode: true, reference: true, customer: { select: { name: true } }, receipt: { select: { receiptNumber: true } } },
    }),
    prisma.payment.groupBy({ by: ["mode"], where, _sum: { amount: true }, _count: true }),
  ]);
  const total = byMode.reduce((s, m) => s + n(m._sum.amount), 0);
  res.json({
    range: { from: q.from, to: q.to },
    summary: { total: Math.round(total * 100) / 100, byMode: byMode.map((m) => ({ mode: m.mode, count: m._count, amount: n(m._sum.amount) })) },
    rows,
  });
}));

/** Outstanding — unpaid/partial invoices grouped by customer. */
reportsRouter.get("/outstanding", authorize("report:read"), h(async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const today = dayStart(new Date());
  const rows = await prisma.invoice.findMany({
    where: { tenantId, status: { in: ["UNPAID", "PARTIAL"] } },
    select: { customerId: true, grandTotal: true, amountPaid: true, creditedAmount: true, dueDate: true, customer: { select: { name: true, phone: true } } },
  });
  const byCustomer = new Map<string, { name: string; phone: string | null; outstanding: number; overdue: number; count: number }>();
  for (const r of rows) {
    const due = n(r.grandTotal) - n(r.amountPaid) - n(r.creditedAmount);
    const rec = byCustomer.get(r.customerId) ?? { name: r.customer.name, phone: r.customer.phone, outstanding: 0, overdue: 0, count: 0 };
    rec.outstanding += due;
    rec.count += 1;
    if (r.dueDate < today) rec.overdue += due;
    byCustomer.set(r.customerId, rec);
  }
  const list = [...byCustomer.entries()]
    .map(([customerId, v]) => ({ customerId, ...v, outstanding: Math.round(v.outstanding * 100) / 100, overdue: Math.round(v.overdue * 100) / 100 }))
    .sort((a, b) => b.outstanding - a.outstanding);
  res.json({
    summary: { totalOutstanding: Math.round(list.reduce((s, r) => s + r.outstanding, 0) * 100) / 100, customers: list.length },
    rows: list,
  });
}));

/** Party statement (ledger with running balance, Dr = debit − credit).
 *  The party's stored opening balance is folded in: customer +ve = owes us (Dr);
 *  supplier +ve = we owe them (Cr, hence negated in Dr terms). */
async function statement(tenantId: string, partyType: "CUSTOMER" | "SUPPLIER", partyId: string, from?: Date, to?: Date) {
  const partyOpening = partyType === "CUSTOMER"
    ? n((await prisma.customer.findFirst({ where: { id: partyId, tenantId }, select: { openingBalance: true } }))?.openingBalance)
    : -n((await prisma.supplier.findFirst({ where: { id: partyId, tenantId }, select: { openingBalance: true } }))?.openingBalance);
  let opening = partyOpening;
  if (from) {
    const prior = await prisma.ledgerEntry.aggregate({
      where: { tenantId, partyType, partyId, entryDate: { lt: dayStart(from) } },
      _sum: { debit: true, credit: true },
    });
    opening = Math.round((partyOpening + n(prior._sum.debit) - n(prior._sum.credit)) * 100) / 100;
  }
  const rows = await prisma.ledgerEntry.findMany({
    where: { tenantId, partyType, partyId, ...(from || to ? { entryDate: { ...(from ? { gte: dayStart(from) } : {}), ...(to ? { lte: dayEnd(to) } : {}) } } : {}) },
    orderBy: { entryDate: "asc" },
  });
  let balance = opening;
  const entries = rows.map((r) => {
    balance = Math.round((balance + n(r.debit) - n(r.credit)) * 100) / 100;
    return { ...r, balance };
  });
  return { opening, closing: balance, entries };
}

reportsRouter.get("/customer-statement/:customerId", authorize("report:read"), h(async (req, res) => {
  const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  const tenantId = req.auth!.tenantId;
  const customer = await prisma.customer.findFirst({ where: { id: req.params.customerId, tenantId }, select: { id: true, name: true, phone: true, gstin: true } });
  if (!customer) throw notFound("Customer");
  res.json({ party: customer, ...(await statement(tenantId, "CUSTOMER", customer.id, q.from, q.to)) });
}));

reportsRouter.get("/supplier-statement/:supplierId", authorize("report:read"), h(async (req, res) => {
  const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  const tenantId = req.auth!.tenantId;
  const supplier = await prisma.supplier.findFirst({ where: { id: req.params.supplierId, tenantId }, select: { id: true, name: true, phone: true, gstin: true } });
  if (!supplier) throw notFound("Supplier");
  res.json({ party: supplier, ...(await statement(tenantId, "SUPPLIER", supplier.id, q.from, q.to)) });
}));

/** Profit & Loss (GST-exclusive; salaries flow in via the Salaries expense category). */
reportsRouter.get("/profit-loss", authorize("report:read"), h(async (req, res) => {
  const q = parse(dateRange, req.query);
  const tenantId = req.auth!.tenantId;
  const inv = rangeWhere(q.from, q.to);
  const [sales, creditNotes, debitNotes, purchases, purchaseReturns, expenseByCat] = await Promise.all([
    prisma.invoice.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: inv }, _sum: { taxableValue: true } }),
    prisma.creditNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { taxableValue: true } }),
    prisma.debitNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { taxableValue: true } }),
    prisma.purchaseInvoice.aggregate({ where: { tenantId, invoiceDate: inv }, _sum: { taxableValue: true } }),
    prisma.purchaseReturn.aggregate({ where: { tenantId, returnDate: inv }, _sum: { taxableValue: true } }),
    prisma.expense.groupBy({ by: ["categoryId"], where: { tenantId, status: "RECORDED", expenseDate: inv }, _sum: { amount: true } }),
  ]);
  const cats = await prisma.expenseCategory.findMany({ where: { tenantId, id: { in: expenseByCat.map((e) => e.categoryId) } }, select: { id: true, name: true } });
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const expenses = expenseByCat
    .map((e) => ({ category: catName.get(e.categoryId) ?? "?", amount: n(e._sum.amount) }))
    .sort((a, b) => b.amount - a.amount);
  const round = (v: number) => Math.round(v * 100) / 100;

  const revenue = round(n(sales._sum.taxableValue) - n(creditNotes._sum.taxableValue) + n(debitNotes._sum.taxableValue));
  const cogs = round(n(purchases._sum.taxableValue) - n(purchaseReturns._sum.taxableValue));
  const grossProfit = round(revenue - cogs);
  const expenseTotal = round(expenses.reduce((s, e) => s + e.amount, 0));
  const netProfit = round(grossProfit - expenseTotal);

  res.json({
    range: { from: q.from, to: q.to },
    revenue, cogs, grossProfit, expenseTotal, netProfit,
    breakdown: { salesTaxable: n(sales._sum.taxableValue), creditNotes: n(creditNotes._sum.taxableValue), debitNotes: n(debitNotes._sum.taxableValue), purchasesTaxable: n(purchases._sum.taxableValue), expenses },
  });
}));

/** Profit & Loss — Tally two-sided format (trading + income sections). */
reportsRouter.get("/profit-loss-tally", authorize("report:read"), h(async (req, res) => {
  const q = parse(dateRange, req.query);
  res.json(await computeTallyPnl(req.auth!.tenantId, q.from, q.to));
}));

/** Balance Sheet — Tally two-sided format (Liabilities | Assets) as on a date. */
reportsRouter.get("/balance-sheet", authorize("report:read"), h(async (req, res) => {
  const q = parse(z.object({ asOn: z.coerce.date() }), req.query);
  res.json(await computeBalanceSheet(req.auth!.tenantId, q.asOn));
}));

/** Dashboard KPIs. */
reportsRouter.get("/dashboard", authorize("report:read"), h(async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const now = new Date();
  const todayFrom = dayStart(now), todayTo = dayEnd(now);
  const monthFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [todayColl, mtdSales, outstanding, openComplaints, lowStock] = await Promise.all([
    prisma.payment.aggregate({ where: { tenantId, status: "SUCCESS", paymentDate: { gte: todayFrom, lte: todayTo } }, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: { gte: monthFrom, lte: todayTo } }, _sum: { grandTotal: true } }),
    prisma.invoice.findMany({ where: { tenantId, status: { in: ["UNPAID", "PARTIAL"] } }, select: { grandTotal: true, amountPaid: true, creditedAmount: true } }),
    prisma.complaint.count({ where: { tenantId, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
    prisma.product.count({ where: { tenantId, isActive: true, isService: false, stockQty: { lte: prisma.product.fields.reorderLevel } } }),
  ]);
  const outstandingTotal = Math.round(outstanding.reduce((s, i) => s + n(i.grandTotal) - n(i.amountPaid) - n(i.creditedAmount), 0) * 100) / 100;
  res.json({
    todayCollection: n(todayColl._sum.amount),
    mtdSales: n(mtdSales._sum.grandTotal),
    outstanding: outstandingTotal,
    openComplaints,
    lowStock,
  });
}));
