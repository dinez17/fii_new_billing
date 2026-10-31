import { syncSourceJournal } from "./automatic-journals.js";
import { Prisma } from "@prisma/client";
type Tx = Prisma.TransactionClient;
const start = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const end = (date: Date) => new Date(start(date).getTime() + 86400000 - 1);
const zero = () => new Prisma.Decimal(0);

/** Rebuild affected closing snapshots, preserving their closed status and audit identity. */
export async function rebuildExpenseDayClosings(tx: Tx, tenantId: string, from: Date) {
  const closings = await tx.dayBookClosing.findMany({ where: { tenantId, closingDate: { gte: start(from) } }, orderBy: { closingDate: "asc" } });
  const previous = await tx.dayBookClosing.findFirst({ where: { tenantId, closingDate: { lt: start(from) } }, orderBy: { closingDate: "desc" } });
  let since = previous ? end(previous.closingDate) : new Date(0);
  let balance = previous?.closingBalance ?? zero();
  for (const closing of closings) {
    const entries = await tx.dayBookEntry.findMany({ where: { tenantId, entryDate: { gt: since, lte: end(closing.closingDate) } } });
    let opening = balance, cashIn = zero(), cashOut = zero();
    for (const entry of entries) {
      if (entry.entryDate < start(closing.closingDate)) opening = entry.type === "CASH_IN" ? opening.plus(entry.amount) : opening.minus(entry.amount);
      else if (entry.type === "CASH_IN") cashIn = cashIn.plus(entry.amount);
      else cashOut = cashOut.plus(entry.amount);
    }
    balance = opening.plus(cashIn).minus(cashOut);
    await tx.dayBookClosing.update({ where: { id: closing.id }, data: { openingBalance: opening, totalCashIn: cashIn, totalCashOut: cashOut, closingBalance: balance } });
    since = end(closing.closingDate);
  }
  return closings.length;
}

/** Both cancellation and event posting use tenant -> expense locks in the same order. */
async function lockedExpense(tx: Tx, tenantId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
  return tx.expense.findFirst({ where: { id, tenantId }, include: { category: { select: { name: true } } } });
}

export async function cancelExpenseDayBook(tx: Tx, tenantId: string, id: string, userId?: string) {
  const expense = await lockedExpense(tx, tenantId, id);
  if (!expense) throw new Error("Expense not found");
  const postings = await tx.dayBookEntry.findMany({ where: { tenantId, refType: "EXPENSE", refId: id } });
  const updated = expense.status === "CANCELLED" ? expense : await tx.expense.update({ where: { id }, data: { status: "CANCELLED" } });
  await syncSourceJournal(tx,tenantId,"EXPENSE",id,userId);
  await tx.dayBookEntry.deleteMany({ where: { tenantId, refType: "EXPENSE", refId: id } });
  const firstDate = postings.reduce((date, posting) => posting.entryDate < date ? posting.entryDate : date, expense.expenseDate);
  const closings = postings.length ? await rebuildExpenseDayClosings(tx, tenantId, firstDate) : 0;
  if (expense.status !== "CANCELLED" || postings.length) await tx.auditLog.create({ data: { tenantId, userId, action: "EXPENSE_CANCELLED_DAYBOOK_RECONCILED", entity: "Expense", entityId: id,
    before: { status: expense.status, postings: JSON.parse(JSON.stringify(postings)) }, after: { status: "CANCELLED", removedPostings: postings.length, rebuiltClosings: closings } } });
  return { expense: updated, removedPostings: postings.length, rebuiltClosings: closings };
}

/** Read the authoritative expense, not an old creation event's amount/status/date. */
export async function postRecordedExpenseDayBook(tx: Tx, tenantId: string, id: string) {
  const expense = await lockedExpense(tx, tenantId, id);
  if (!expense || expense.status !== "RECORDED") return { posted: false };
  if (await tx.dayBookEntry.findFirst({ where: { tenantId, refType: "EXPENSE", refId: id } })) return { posted: false };
  await tx.dayBookEntry.create({ data: { id: `expense:${id}`, tenantId, fyCode: expense.fyCode, entryDate: start(expense.expenseDate), type: "CASH_OUT", source: "EXPENSE", mode: expense.mode, financialAccountId: expense.financialAccountId, amount: expense.total, refType: "EXPENSE", refId: id, narration: `Expense — ${expense.category.name}`, createdById: expense.createdById } });
  await rebuildExpenseDayClosings(tx, tenantId, expense.expenseDate);
  return { posted: true };
}
