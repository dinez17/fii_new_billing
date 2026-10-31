import { Prisma } from "@prisma/client";
export interface CustomerPaymentPosting {
  tenantId: string; customerId: string; paymentId: string; fyCode: string; entryDate: Date;
  amount: string; tdsAmount?: string; mode: Prisma.DayBookEntryCreateInput["mode"]; receiptNumber: string; actorId?: string | null;
}
/** Called by the ledger worker inside one transaction. TDS never enters cash/bank. */
export async function postCustomerPayment(tx: Prisma.TransactionClient, input: CustomerPaymentPosting) {
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "tenantId" = ${input.tenantId} AND id = ${input.paymentId} FOR UPDATE`;
  const payment = await tx.payment.findFirst({ where: { tenantId: input.tenantId, id: input.paymentId } });
  if (!payment || payment.status !== "SUCCESS") return;
  if (await tx.ledgerEntry.findFirst({ where: { tenantId: input.tenantId, refType: "PAYMENT", refId: input.paymentId } })) return;
  const cash = new Prisma.Decimal(input.amount), tds = new Prisma.Decimal(input.tdsAmount ?? 0);
  if (cash.isNegative() || tds.isNegative() || !cash.add(tds).gt(0)) throw new Error("Invalid payment posting amount");
  await tx.ledgerEntry.create({ data: {
    tenantId: input.tenantId, partyType: "CUSTOMER", partyId: input.customerId, fyCode: input.fyCode,
    entryDate: input.entryDate, entryType: "PAYMENT", refType: "PAYMENT", refId: input.paymentId,
    refNumber: input.receiptNumber, credit: cash.add(tds),
    narration: `Receipt ${input.receiptNumber}: money received ${cash.toFixed(2)}${tds.gt(0) ? `; TDS deducted ${tds.toFixed(2)} (non-cash)` : ""}`,
  } });
  if (cash.gt(0)) await tx.dayBookEntry.create({ data: {
    tenantId: input.tenantId, fyCode: input.fyCode, entryDate: input.entryDate, type: "CASH_IN", source: "INVOICE_PAYMENT",
    mode: input.mode, financialAccountId: payment.financialAccountId, amount: cash, refType: "PAYMENT", refId: input.paymentId,
    narration: `Receipt ${input.receiptNumber} — actual money received`, createdById: input.actorId ?? undefined,
  } });
}
