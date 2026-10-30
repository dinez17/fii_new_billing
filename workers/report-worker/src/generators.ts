import { prisma, computeTallyPnl, computeBalanceSheet, type TallySide } from "@fii/database";

export interface TableData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  summary?: [string, string | number][];
}

type Filters = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const round = (v: number) => Math.round(v * 100) / 100;
const d = (v: unknown): Date => new Date(String(v));
const day = (v: Date) => `${String(v.getUTCDate()).padStart(2, "0")}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${v.getUTCFullYear()}`;
const start = (x: Date) => new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 0, 0, 0));
const end = (x: Date) => new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 23, 59, 59, 999));
const range = (f: Filters) => ({ gte: start(d(f.from)), lte: end(d(f.to)) });

async function sales(tenantId: string, f: Filters): Promise<TableData> {
  const rows = await prisma.invoice.findMany({
    where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: range(f) },
    orderBy: { invoiceDate: "asc" }, take: 5000,
    select: { invoiceNumber: true, invoiceDate: true, taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true, amountPaid: true, customer: { select: { name: true } } },
  });
  return {
    title: `Sales register ${day(d(f.from))} to ${day(d(f.to))}`,
    columns: ["Invoice", "Date", "Customer", "Taxable", "CGST", "SGST", "IGST", "Total", "Paid"],
    rows: rows.map((r) => [r.invoiceNumber, day(r.invoiceDate), r.customer.name, num(r.taxableValue), num(r.cgst), num(r.sgst), num(r.igst), num(r.grandTotal), num(r.amountPaid)]),
    summary: [
      ["Invoices", rows.length],
      ["Taxable", round(rows.reduce((s, r) => s + num(r.taxableValue), 0))],
      ["Grand total", round(rows.reduce((s, r) => s + num(r.grandTotal), 0))],
    ],
  };
}

async function purchases(tenantId: string, f: Filters): Promise<TableData> {
  const rows = await prisma.purchaseInvoice.findMany({
    where: { tenantId, invoiceDate: range(f) },
    orderBy: { invoiceDate: "asc" }, take: 5000,
    select: { ourNumber: true, billNumber: true, invoiceDate: true, taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true, supplier: { select: { name: true } } },
  });
  return {
    title: `Purchase register ${day(d(f.from))} to ${day(d(f.to))}`,
    columns: ["Our No", "Bill No", "Date", "Supplier", "Taxable", "CGST", "SGST", "IGST", "Total"],
    rows: rows.map((r) => [r.ourNumber, r.billNumber, day(r.invoiceDate), r.supplier.name, num(r.taxableValue), num(r.cgst), num(r.sgst), num(r.igst), num(r.grandTotal)]),
    summary: [["Bills", rows.length], ["Taxable", round(rows.reduce((s, r) => s + num(r.taxableValue), 0))], ["Grand total", round(rows.reduce((s, r) => s + num(r.grandTotal), 0))]],
  };
}

async function collections(tenantId: string, f: Filters): Promise<TableData> {
  const rows = await prisma.payment.findMany({
    where: { tenantId, status: "SUCCESS", paymentDate: range(f) },
    orderBy: { paymentDate: "asc" }, take: 5000,
    select: { paymentDate: true, amount: true, mode: true, reference: true, customer: { select: { name: true } }, receipt: { select: { receiptNumber: true } } },
  });
  return {
    title: `Collections ${day(d(f.from))} to ${day(d(f.to))}`,
    columns: ["Date", "Receipt", "Customer", "Mode", "Reference", "Amount"],
    rows: rows.map((r) => [day(r.paymentDate), r.receipt?.receiptNumber ?? "-", r.customer.name, r.mode, r.reference ?? "", num(r.amount)]),
    summary: [["Payments", rows.length], ["Total", round(rows.reduce((s, r) => s + num(r.amount), 0))]],
  };
}

async function outstanding(tenantId: string): Promise<TableData> {
  const inv = await prisma.invoice.findMany({
    where: { tenantId, status: { in: ["UNPAID", "PARTIAL"] } },
    select: { customerId: true, grandTotal: true, amountPaid: true, creditedAmount: true, customer: { select: { name: true, phone: true } } },
  });
  const byCust = new Map<string, { name: string; phone: string | null; due: number; count: number }>();
  for (const r of inv) {
    const due = num(r.grandTotal) - num(r.amountPaid) - num(r.creditedAmount);
    const rec = byCust.get(r.customerId) ?? { name: r.customer.name, phone: r.customer.phone, due: 0, count: 0 };
    rec.due += due; rec.count += 1; byCust.set(r.customerId, rec);
  }
  const list = [...byCust.values()].sort((a, b) => b.due - a.due);
  return {
    title: "Outstanding receivables",
    columns: ["Customer", "Phone", "Open invoices", "Outstanding"],
    rows: list.map((r) => [r.name, r.phone ?? "", r.count, round(r.due)]),
    summary: [["Customers", list.length], ["Total outstanding", round(list.reduce((s, r) => s + r.due, 0))]],
  };
}

async function dayBook(tenantId: string, f: Filters): Promise<TableData> {
  const date = d(f.date ?? new Date());
  const from = f.from ? start(d(f.from)) : start(date), to = f.to ? end(d(f.to)) : end(date);
  const rows = await prisma.dayBookEntry.findMany({
    where: { tenantId, ...(f.fyCode ? { fyCode: String(f.fyCode) } : {}), entryDate: { gte: from, lte: to } },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  let cashIn = 0, cashOut = 0;
  for (const r of rows) (r.type === "CASH_IN" ? (cashIn += num(r.amount)) : (cashOut += num(r.amount)));
  return {
    title: `Day book ${day(from)} to ${day(to)}`,
    columns: ["Date", "Type", "Source", "Mode", "Narration", "Amount"],
    rows: rows.map((r) => [day(r.entryDate), r.type, r.source, r.mode ?? "-", r.narration ?? "", num(r.amount)]),
    summary: [["Cash in", round(cashIn)], ["Cash out", round(cashOut)], ["Net", round(cashIn - cashOut)]],
  };
}

async function profitLoss(tenantId: string, f: Filters): Promise<TableData> {
  const inv = range(f);
  const [sales, cn, dn, pur, pret, expCat] = await Promise.all([
    prisma.invoice.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: inv }, _sum: { taxableValue: true } }),
    prisma.creditNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { taxableValue: true } }),
    prisma.debitNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { taxableValue: true } }),
    prisma.purchaseInvoice.aggregate({ where: { tenantId, invoiceDate: inv }, _sum: { taxableValue: true } }),
    prisma.purchaseReturn.aggregate({ where: { tenantId, returnDate: inv }, _sum: { taxableValue: true } }),
    prisma.expense.groupBy({ by: ["categoryId"], where: { tenantId, status: "RECORDED", expenseDate: inv }, _sum: { amount: true } }),
  ]);
  const cats = await prisma.expenseCategory.findMany({ where: { tenantId, id: { in: expCat.map((e) => e.categoryId) } }, select: { id: true, name: true } });
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const revenue = round(num(sales._sum.taxableValue) - num(cn._sum.taxableValue) + num(dn._sum.taxableValue));
  const cogs = round(num(pur._sum.taxableValue) - num(pret._sum.taxableValue));
  const rows: (string | number)[][] = [
    ["Revenue (net of notes)", revenue],
    ["Cost of goods (purchases)", cogs],
    ["Gross profit", round(revenue - cogs)],
  ];
  let expTotal = 0;
  for (const e of expCat.sort((a, b) => num(b._sum.amount) - num(a._sum.amount))) {
    const amt = num(e._sum.amount); expTotal += amt;
    rows.push([`  Expense — ${catName.get(e.categoryId) ?? "?"}`, round(amt)]);
  }
  rows.push(["Total expenses", round(expTotal)]);
  rows.push(["Net profit", round(revenue - cogs - expTotal)]);
  return { title: `Profit & Loss ${day(d(f.from))} to ${day(d(f.to))}`, columns: ["Line", "Amount"], rows };
}

/** Zip two Tally sides into 4-column rows: Particulars | Amount | Particulars | Amount. */
function zipSides(left: TallySide, right: TallySide, totalLabel = "Total"): (string | number)[][] {
  const fmt = (l?: { particulars: string; amount: number; indent?: boolean }) =>
    l ? [`${l.indent ? "    " : ""}${l.particulars}`, l.amount] as (string | number)[] : ["", ""] as (string | number)[];
  const rows: (string | number)[][] = [];
  for (let i = 0; i < Math.max(left.lines.length, right.lines.length); i++) {
    rows.push([...fmt(left.lines[i]), ...fmt(right.lines[i])]);
  }
  rows.push([totalLabel, left.total, totalLabel, right.total]);
  return rows;
}

async function profitLossTally(tenantId: string, f: Filters): Promise<TableData> {
  const pnl = await computeTallyPnl(tenantId, start(d(f.from)), end(d(f.to)));
  return {
    title: `Profit & Loss A/c (Tally format) ${day(d(f.from))} to ${day(d(f.to))}`,
    columns: ["Particulars (Dr)", "Amount", "Particulars (Cr)", "Amount"],
    rows: [
      ...zipSides(pnl.trading.left, pnl.trading.right),
      ["", "", "", ""],
      ...zipSides(pnl.income.left, pnl.income.right),
    ],
    summary: [
      ["Gross profit", pnl.grossProfit],
      ["Nett profit", pnl.netProfit],
    ],
  };
}

async function balanceSheet(tenantId: string, f: Filters): Promise<TableData> {
  const asOn = f.asOn ? d(f.asOn) : new Date();
  const bs = await computeBalanceSheet(tenantId, asOn);
  return {
    title: `Balance Sheet as at ${day(asOn)}`,
    columns: ["Liabilities", "Amount", "Assets", "Amount"],
    rows: zipSides(bs.liabilities, bs.assets),
    summary: [
      ["Sundry Debtors", bs.detail.sundryDebtors],
      ["Sundry Creditors", bs.detail.sundryCreditors],
      ["Closing Stock", bs.detail.closingStock],
      ["Profit & Loss A/c", bs.detail.profitAndLoss],
    ],
  };
}

async function gstr3b(tenantId: string, f: Filters): Promise<TableData> {
  const year = Number(f.year), month = Number(f.month);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const inv = { gte: from, lte: to };
  const [sales, cn, dn, pur, exp] = await Promise.all([
    prisma.invoice.aggregate({ where: { tenantId, chargeGst: true, status: { not: "CANCELLED" }, invoiceDate: inv }, _sum: { taxableValue: true, cgst: true, sgst: true, igst: true } }),
    prisma.creditNote.aggregate({ where: { tenantId, invoice: { tenantId, chargeGst: true }, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.debitNote.aggregate({ where: { tenantId, invoice: { tenantId, chargeGst: true }, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.purchaseInvoice.aggregate({ where: { tenantId, invoiceDate: inv }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.expense.aggregate({ where: { tenantId, status: "RECORDED", expenseDate: inv }, _sum: { gstAmount: true } }),
  ]);
  const outCgst = round(num(sales._sum.cgst) - num(cn._sum.cgst) + num(dn._sum.cgst));
  const outSgst = round(num(sales._sum.sgst) - num(cn._sum.sgst) + num(dn._sum.sgst));
  const outIgst = round(num(sales._sum.igst) - num(cn._sum.igst) + num(dn._sum.igst));
  const expHalf = round(num(exp._sum.gstAmount) / 2);
  const itcCgst = round(num(pur._sum.cgst) + expHalf), itcSgst = round(num(pur._sum.sgst) + expHalf), itcIgst = round(num(pur._sum.igst));
  return {
    title: `GSTR-3B ${year}-${String(month).padStart(2, "0")}`,
    columns: ["Head", "CGST", "SGST", "IGST"],
    rows: [
      ["Outward tax", outCgst, outSgst, outIgst],
      ["Input tax credit", itcCgst, itcSgst, itcIgst],
      ["Net payable", round(outCgst - itcCgst), round(outSgst - itcSgst), round(outIgst - itcIgst)],
    ],
    summary: [["Outward taxable", round(num(sales._sum.taxableValue))]],
  };
}

async function statement(tenantId: string, partyType: "CUSTOMER" | "SUPPLIER", f: Filters): Promise<TableData> {
  const partyId = String(partyType === "CUSTOMER" ? f.customerId : f.supplierId);
  const party = partyType === "CUSTOMER"
    ? await prisma.customer.findFirst({ where: { id: partyId, tenantId }, select: { name: true, openingBalance: true } })
    : await prisma.supplier.findFirst({ where: { id: partyId, tenantId }, select: { name: true, openingBalance: true } });

  // party's stored opening balance in Dr terms (customer +ve = owes us;
  // supplier +ve = we owe them → negative Dr), plus entries before the from date
  const partyOpening = (partyType === "CUSTOMER" ? 1 : -1) * num(party?.openingBalance);
  let opening = partyOpening;
  if (f.from) {
    const prior = await prisma.ledgerEntry.aggregate({
      where: { tenantId, partyType, partyId, entryDate: { lt: start(d(f.from)) } },
      _sum: { debit: true, credit: true },
    });
    opening = round(partyOpening + num(prior._sum.debit) - num(prior._sum.credit));
  }

  const rows = await prisma.ledgerEntry.findMany({
    where: { tenantId, partyType, partyId, ...(f.from || f.to ? { entryDate: { ...(f.from ? { gte: start(d(f.from)) } : {}), ...(f.to ? { lte: end(d(f.to)) } : {}) } } : {}) },
    orderBy: { entryDate: "asc" }, take: 5000,
  });
  let bal = opening;
  const out: (string | number)[][] = [
    [f.from ? day(d(f.from)) : "", "", "Opening Balance", "", "", opening],
    ...rows.map((r) => { bal = round(bal + num(r.debit) - num(r.credit)); return [day(r.entryDate), r.refNumber ?? "", r.narration ?? "", num(r.debit), num(r.credit), bal] as (string | number)[]; }),
  ];
  const range = f.from || f.to ? ` ${f.from ? day(d(f.from)) : "…"} to ${f.to ? day(d(f.to)) : "…"}` : "";
  return {
    title: `${party?.name ?? partyType} — ${partyType === "CUSTOMER" ? "Customer" : "Supplier"} Ledger${range}`,
    columns: ["Date", "Ref", "Narration", "Debit", "Credit", "Balance"],
    rows: out,
    summary: [
      ["Opening balance", opening],
      ["Total debit", round(rows.reduce((s, r) => s + num(r.debit), 0))],
      ["Total credit", round(rows.reduce((s, r) => s + num(r.credit), 0))],
      ["Closing balance", bal],
    ],
  };
}

async function gstr1(tenantId: string, f: Filters): Promise<TableData> {
  const inv = await prisma.invoice.findMany({
    where: { tenantId, chargeGst: true, status: { not: "CANCELLED" }, invoiceDate: range(f) },
    select: { invoiceNumber: true, invoiceDate: true, placeOfSupply: true, taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true, customer: { select: { name: true, gstin: true } } },
    orderBy: { invoiceDate: "asc" }, take: 5000,
  });
  return {
    title: `GSTR-1 outward supplies ${day(d(f.from))} to ${day(d(f.to))}`,
    columns: ["Invoice", "Date", "GSTIN", "Customer", "POS", "Taxable", "CGST", "SGST", "IGST", "Total"],
    rows: inv.map((r) => [r.invoiceNumber, day(r.invoiceDate), r.customer.gstin ?? "URP", r.customer.name, r.placeOfSupply, num(r.taxableValue), num(r.cgst), num(r.sgst), num(r.igst), num(r.grandTotal)]),
    summary: [["Invoices", inv.length], ["Taxable", round(inv.reduce((s, r) => s + num(r.taxableValue), 0))], ["Tax", round(inv.reduce((s, r) => s + num(r.cgst) + num(r.sgst) + num(r.igst), 0))]],
  };
}

export async function generate(reportType: string, tenantId: string, filters: Filters): Promise<TableData> {
  switch (reportType) {
    case "SALES": return sales(tenantId, filters);
    case "PURCHASES": return purchases(tenantId, filters);
    case "COLLECTIONS": return collections(tenantId, filters);
    case "OUTSTANDING": return outstanding(tenantId);
    case "DAY_BOOK": return dayBook(tenantId, filters);
    case "PROFIT_LOSS": return profitLoss(tenantId, filters);
    case "PROFIT_LOSS_TALLY": return profitLossTally(tenantId, filters);
    case "BALANCE_SHEET": return balanceSheet(tenantId, filters);
    case "GSTR1": return gstr1(tenantId, filters);
    case "GSTR3B": return gstr3b(tenantId, filters);
    case "CUSTOMER_STATEMENT": return statement(tenantId, "CUSTOMER", filters);
    case "SUPPLIER_STATEMENT": return statement(tenantId, "SUPPLIER", filters);
    default: throw new Error(`Unknown reportType ${reportType}`);
  }
}
