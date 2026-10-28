import { prisma } from "./client.js";

/**
 * Tally-style financial statements (two-sided Dr/Cr layout).
 *
 * Shared by accounting-service (live reports) and report-worker (exports)
 * so both always show identical numbers.
 *
 * Conventions (simplified trading business books):
 *  - Values are GST-exclusive (taxable values); GST sits in Duties & Taxes.
 *  - Stock valued at purchase price (qty on the date × product.purchasePrice).
 *  - Sundry Debtors  = customer ledger Σ(debit − credit)   → asset
 *  - Sundry Creditors = supplier ledger Σ(credit − debit)  → liability
 *  - Cash / Bank from Day Book (CASH mode vs all other modes).
 */

export interface TallyLine {
  particulars: string;
  amount: number;
  /** visual grouping: bold total-ish lines */
  bold?: boolean;
  /** indented sub-line (e.g. expense category under Indirect Expenses) */
  indent?: boolean;
}
export interface TallySide { lines: TallyLine[]; total: number }
export interface TallySection { left: TallySide; right: TallySide }

const r2 = (v: number) => Math.round(v * 100) / 100;
const n = (v: unknown) => Number(v ?? 0);
const dayEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));

const IN_TYPES = ["PURCHASE_IN", "ADJUST_IN", "OPENING"] as const;

/** Stock value (at purchase price) as at end of `asOn`.
 *  Reconstructed backwards: current qty − signed movements after the date. */
export async function stockValueAt(tenantId: string, asOn: Date): Promise<number> {
  const upTo = dayEnd(asOn);
  const products = await prisma.product.findMany({
    where: { tenantId, isService: false },
    select: { id: true, stockQty: true, purchasePrice: true },
  });
  if (products.length === 0) return 0;
  const after = await prisma.stockMovement.groupBy({
    by: ["productId", "type"],
    where: { tenantId, createdAt: { gt: upTo }, productId: { in: products.map((p) => p.id) } },
    _sum: { quantity: true },
  });
  const delta = new Map<string, number>(); // net movement AFTER the date, signed
  for (const m of after) {
    const signed = (IN_TYPES as readonly string[]).includes(m.type) ? n(m._sum.quantity) : -n(m._sum.quantity);
    delta.set(m.productId, (delta.get(m.productId) ?? 0) + signed);
  }
  let value = 0;
  for (const p of products) {
    const qtyAt = n(p.stockQty) - (delta.get(p.id) ?? 0);
    if (qtyAt > 0) value += qtyAt * n(p.purchasePrice);
  }
  return r2(value);
}

interface PnlNumbers {
  openingStock: number;
  closingStock: number;
  purchases: number; // net of purchase returns
  sales: number; // net of credit notes, plus debit notes
  expenses: { category: string; amount: number }[];
  expenseTotal: number;
  grossProfit: number; // may be negative (gross loss)
  netProfit: number; // may be negative (nett loss)
}

async function pnlNumbers(tenantId: string, from: Date, to: Date): Promise<PnlNumbers> {
  const range = { gte: dayStart(from), lte: dayEnd(to) };
  const dayBefore = new Date(dayStart(from).getTime() - 24 * 3600 * 1000);
  const [openingStock, closingStock, sales, cn, dn, purch, pret, expByCat] = await Promise.all([
    stockValueAt(tenantId, dayBefore),
    stockValueAt(tenantId, to),
    prisma.invoice.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: range }, _sum: { taxableValue: true } }),
    prisma.creditNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: range }, _sum: { taxableValue: true } }),
    prisma.debitNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: range }, _sum: { taxableValue: true } }),
    prisma.purchaseInvoice.aggregate({ where: { tenantId, invoiceDate: range }, _sum: { taxableValue: true } }),
    prisma.purchaseReturn.aggregate({ where: { tenantId, returnDate: range }, _sum: { taxableValue: true } }),
    prisma.expense.groupBy({ by: ["categoryId"], where: { tenantId, status: "RECORDED", expenseDate: range }, _sum: { amount: true } }),
  ]);
  const cats = await prisma.expenseCategory.findMany({
    where: { tenantId, id: { in: expByCat.map((e) => e.categoryId) } },
    select: { id: true, name: true },
  });
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const expenses = expByCat
    .map((e) => ({ category: catName.get(e.categoryId) ?? "Other", amount: r2(n(e._sum.amount)) }))
    .sort((a, b) => b.amount - a.amount);

  const salesNet = r2(n(sales._sum.taxableValue) - n(cn._sum.taxableValue) + n(dn._sum.taxableValue));
  const purchasesNet = r2(n(purch._sum.taxableValue) - n(pret._sum.taxableValue));
  const expenseTotal = r2(expenses.reduce((s, e) => s + e.amount, 0));
  // Trading a/c: GP = (Sales + Closing stock) − (Opening stock + Purchases)
  const grossProfit = r2(salesNet + closingStock - openingStock - purchasesNet);
  const netProfit = r2(grossProfit - expenseTotal);
  return { openingStock, closingStock, purchases: purchasesNet, sales: salesNet, expenses, expenseTotal, grossProfit, netProfit };
}

export interface TallyPnl extends PnlNumbers {
  from: Date;
  to: Date;
  /** Trading account: Dr = opening stock + purchases + GP c/o · Cr = sales + closing stock */
  trading: TallySection;
  /** Income statement: Dr = indirect expenses + nett profit · Cr = GP b/f */
  income: TallySection;
}

export async function computeTallyPnl(tenantId: string, from: Date, to: Date): Promise<TallyPnl> {
  const nums = await pnlNumbers(tenantId, from, to);
  const { openingStock, closingStock, purchases, sales, expenses, expenseTotal, grossProfit, netProfit } = nums;

  // ── Trading account
  const tradingLeft: TallyLine[] = [
    { particulars: "Opening Stock", amount: openingStock },
    { particulars: "Purchase Accounts", amount: purchases },
  ];
  const tradingRight: TallyLine[] = [
    { particulars: "Sales Accounts", amount: sales },
    { particulars: "Closing Stock", amount: closingStock },
  ];
  if (grossProfit >= 0) tradingLeft.push({ particulars: "Gross Profit c/o", amount: grossProfit, bold: true });
  else tradingRight.push({ particulars: "Gross Loss c/o", amount: r2(-grossProfit), bold: true });
  const tradingTotal = r2(Math.max(
    tradingLeft.reduce((s, l) => s + l.amount, 0),
    tradingRight.reduce((s, l) => s + l.amount, 0),
  ));

  // ── Income statement (below the line)
  const incomeLeft: TallyLine[] = [];
  const incomeRight: TallyLine[] = [];
  if (grossProfit >= 0) incomeRight.push({ particulars: "Gross Profit b/f", amount: grossProfit, bold: true });
  else incomeLeft.push({ particulars: "Gross Loss b/f", amount: r2(-grossProfit), bold: true });
  if (expenses.length > 0) {
    incomeLeft.push({ particulars: "Indirect Expenses", amount: expenseTotal });
    for (const e of expenses) incomeLeft.push({ particulars: e.category, amount: e.amount, indent: true });
  }
  if (netProfit >= 0) incomeLeft.push({ particulars: "Nett Profit", amount: netProfit, bold: true });
  else incomeRight.push({ particulars: "Nett Loss", amount: r2(-netProfit), bold: true });
  const sum = (lines: TallyLine[]) => r2(lines.filter((l) => !l.indent).reduce((s, l) => s + l.amount, 0));
  const incomeTotal = r2(Math.max(sum(incomeLeft), sum(incomeRight)));

  return {
    ...nums,
    from,
    to,
    trading: { left: { lines: tradingLeft, total: tradingTotal }, right: { lines: tradingRight, total: tradingTotal } },
    income: { left: { lines: incomeLeft, total: incomeTotal }, right: { lines: incomeRight, total: incomeTotal } },
  };
}

export interface TallyBalanceSheet {
  asOn: Date;
  liabilities: TallySide;
  assets: TallySide;
  detail: {
    sundryDebtors: number;
    sundryCreditors: number;
    closingStock: number;
    cashInHand: number;
    bankAccounts: number;
    gstPayable: number; // net output − input (positive = liability, negative = input credit asset)
    profitAndLoss: number; // accumulated profit up to asOn
    difference: number; // plug for unbalanced simplified books (Tally shows this too)
  };
}

const EPOCH = new Date(Date.UTC(2000, 0, 1));

export async function computeBalanceSheet(tenantId: string, asOn: Date): Promise<TallyBalanceSheet> {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, startDate: { lte: asOn }, endDate: { gte: asOn } } });
  const fyStart = fy?.startDate ?? new Date(Date.UTC(asOn.getUTCFullYear() - (asOn.getUTCMonth() < 3 ? 1 : 0), 3, 1));
  const upTo = dayEnd(asOn);
  const upToRange = { lte: upTo };
  const [ledger, dayBook, outGst, cnGst, dnGst, inGst, pretGst, expGst, pnl] = await Promise.all([
    prisma.ledgerEntry.groupBy({
      by: ["partyType"],
      where: { tenantId, entryDate: upToRange },
      _sum: { debit: true, credit: true },
    }),
    prisma.dayBookEntry.groupBy({
      by: ["type", "mode"],
      where: { tenantId, entryDate: upToRange },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: upToRange }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.creditNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: upToRange }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.debitNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: upToRange }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.purchaseInvoice.aggregate({ where: { tenantId, invoiceDate: upToRange }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.purchaseReturn.aggregate({ where: { tenantId, returnDate: upToRange }, _sum: { totalGst: true } }),
    prisma.expense.aggregate({ where: { tenantId, status: "RECORDED", expenseDate: upToRange }, _sum: { gstAmount: true } }),
    pnlNumbers(tenantId, EPOCH, asOn),
  ]);

  // Party balances
  let sundryDebtors = 0, sundryCreditors = 0;
  for (const g of ledger) {
    if (g.partyType === "CUSTOMER") sundryDebtors = r2(n(g._sum.debit) - n(g._sum.credit));
    if (g.partyType === "SUPPLIER") sundryCreditors = r2(n(g._sum.credit) - n(g._sum.debit));
  }

  // Cash / bank from Day Book
  let cashInHand = 0, bankAccounts = 0;
  for (const g of dayBook) {
    const signed = g.type === "CASH_IN" ? n(g._sum.amount) : -n(g._sum.amount);
    if (g.mode === "CASH") cashInHand = r2(cashInHand + signed);
    else bankAccounts = r2(bankAccounts + signed);
  }

  // Duties & Taxes: output GST payable − input tax credit
  const gst3 = (a: { _sum: { cgst: unknown; sgst: unknown; igst: unknown } }) => n(a._sum.cgst) + n(a._sum.sgst) + n(a._sum.igst);
  const outputGst = gst3(outGst) - gst3(cnGst) + gst3(dnGst);
  const inputGst = gst3(inGst) - n(pretGst._sum.totalGst) + n(expGst._sum.gstAmount);
  const gstPayable = r2(outputGst - inputGst);

  const currentPnl = await pnlNumbers(tenantId, fyStart, asOn);
  const closingStock = pnl.closingStock;
  const profitAndLoss = currentPnl.netProfit;
  const retainedEarnings = r2(pnl.netProfit - profitAndLoss);

  // ── Build the two sides
  const liabilities: TallyLine[] = [];
  const assets: TallyLine[] = [];
  if (sundryCreditors !== 0) liabilities.push({ particulars: "Sundry Creditors", amount: sundryCreditors });
  if (gstPayable > 0) liabilities.push({ particulars: "Duties & Taxes (GST payable)", amount: gstPayable });
  liabilities.push({ particulars: profitAndLoss >= 0 ? "Profit & Loss A/c" : "Profit & Loss A/c (Dr)", amount: profitAndLoss, bold: true });
  if (retainedEarnings !== 0) liabilities.push({ particulars: "Retained earnings (prior years)", amount: retainedEarnings });

  if (closingStock !== 0) assets.push({ particulars: "Closing Stock", amount: closingStock });
  if (sundryDebtors !== 0) assets.push({ particulars: "Sundry Debtors", amount: sundryDebtors });
  assets.push({ particulars: "Cash-in-Hand", amount: cashInHand });
  assets.push({ particulars: "Bank Accounts", amount: bankAccounts });
  if (gstPayable < 0) assets.push({ particulars: "Duties & Taxes (GST input credit)", amount: r2(-gstPayable) });

  const liabTotal = r2(liabilities.reduce((s, l) => s + l.amount, 0));
  const assetTotal = r2(assets.reduce((s, l) => s + l.amount, 0));

  // Simplified books rarely tie out to the paisa (opening balances entered
  // directly on parties, payroll accruals, etc.) — show the plug like Tally does.
  const difference = r2(assetTotal - liabTotal);
  if (Math.abs(difference) >= 0.01) {
    if (difference > 0) liabilities.push({ particulars: "Difference in opening balances", amount: difference });
    else assets.push({ particulars: "Difference in opening balances", amount: r2(-difference) });
  }
  const total = r2(Math.max(liabTotal, assetTotal));

  return {
    asOn,
    liabilities: { lines: liabilities, total },
    assets: { lines: assets, total },
    detail: { sundryDebtors, sundryCreditors, closingStock, cashInHand, bankAccounts, gstPayable, profitAndLoss, difference },
  };
}
