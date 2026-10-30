import { Prisma, allocateNumber } from "@fii/database";
import { badRequest, notFound } from "@fii/common";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";

type Tx = Prisma.TransactionClient;

export interface Allocation { invoiceId: string; amount: number; tdsAmount?: number }

/**
 * Shared settlement logic used by BOTH manual payments and gateway captures.
 * Inside an existing transaction: validates + creates allocations, updates
 * invoice paid/status, creates the receipt, writes payment.success and
 * invoice.paid outbox events. Returns the receipt.
 */
export async function settleWithinTx(
  tx: Tx,
  args: {
    tenantId: string;
    paymentId: string;
    customerId: string;
    amount: number;
    tdsAmount?: number;
    mode: string;
    paymentDate: Date;
    fyCode: string;
    allocations: Allocation[];
    actorId?: string | null;
  },
) {
  const { tenantId } = args;
  const paidInvoices: string[] = [];
  const cash = new Prisma.Decimal(args.amount), tds = new Prisma.Decimal(args.tdsAmount ?? 0);
  const allocatedCash = args.allocations.reduce((sum, a) => sum.add(a.amount), new Prisma.Decimal(0));
  const allocatedTds = args.allocations.reduce((sum, a) => sum.add(a.tdsAmount ?? 0), new Prisma.Decimal(0));
  if (cash.isNegative() || tds.isNegative() || !cash.add(tds).gt(0) || allocatedCash.gt(cash) || !allocatedTds.equals(tds)) throw badRequest("Invalid cash/TDS allocations");
  if (new Set(args.allocations.map(a => a.invoiceId)).size !== args.allocations.length) throw badRequest("Duplicate invoice allocation");
  if (args.allocations.length) await tx.$queryRaw`SELECT id FROM "Invoice" WHERE "tenantId" = ${tenantId} AND id IN (${Prisma.join(args.allocations.map(a => a.invoiceId))}) ORDER BY id FOR UPDATE`;


  for (const alloc of args.allocations) {
    const invoice = await tx.invoice.findFirst({
      where: { id: alloc.invoiceId, tenantId, customerId: args.customerId },
    });
    if (!invoice) throw notFound(`Invoice ${alloc.invoiceId}`);
    if (invoice.status === "DRAFT") throw badRequest("Cannot settle a draft invoice");
    if (invoice.status === "CANCELLED") throw badRequest(`Invoice ${invoice.invoiceNumber} is cancelled`);

    // credited amount (sales returns) reduces what can be collected
    const balance = Number(invoice.grandTotal) - Number(invoice.amountPaid) - Number(invoice.creditedAmount);
    const settlement = new Prisma.Decimal(alloc.amount).add(alloc.tdsAmount ?? 0);
    if (alloc.amount < 0 || (alloc.tdsAmount ?? 0) < 0 || !settlement.gt(0)) throw badRequest("Invalid invoice allocation");
    if (settlement.gt(new Prisma.Decimal(balance).add("0.001"))) {
      throw badRequest(`₹${settlement.toFixed(2)} exceeds balance ₹${balance.toFixed(2)} on ${invoice.invoiceNumber}`);
    }

    await tx.paymentAllocation.create({
      data: { paymentId: args.paymentId, invoiceId: invoice.id, amount: new Prisma.Decimal(alloc.amount), tdsAmount: new Prisma.Decimal(alloc.tdsAmount ?? 0) },
    });

    const newPaid = Number(invoice.amountPaid) + settlement.toNumber();
    const fullyPaid = newPaid + Number(invoice.creditedAmount) >= Number(invoice.grandTotal) - 0.001;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: new Prisma.Decimal(newPaid), status: fullyPaid ? "PAID" : "PARTIAL" },
    });
    if (fullyPaid) paidInvoices.push(invoice.invoiceNumber);
  }

  const receiptNumber = await allocateNumber(tx, tenantId, "RECEIPT", args.fyCode);
  const receipt = await tx.receipt.create({
    data: { tenantId, receiptNumber, fyCode: args.fyCode, paymentId: args.paymentId },
  });

  await writeOutbox(tx, tenantId, TOPICS.PAYMENT_SUCCESS, makeEnvelope(tenantId, {
    paymentId: args.paymentId,
    customerId: args.customerId,
    amount: args.amount.toFixed(2),
    tdsAmount: tds.toFixed(2),
    mode: args.mode,
    paymentDate: args.paymentDate.toISOString(),
    receiptNumber,
    allocations: args.allocations,
  }, { actorUserId: args.actorId ?? undefined }));

  for (const invoiceNumber of paidInvoices) {
    await writeOutbox(tx, tenantId, TOPICS.INVOICE_PAID, makeEnvelope(tenantId, {
      invoiceNumber, customerId: args.customerId, paymentId: args.paymentId,
    }, { actorUserId: args.actorId ?? undefined }));
  }

  return receipt;
}

/** Oldest-first allocation across a customer's open invoices. */
export async function autoAllocations(
  tx: Tx,
  tenantId: string,
  customerId: string,
  amount: number,
  restrictTo?: string[],
): Promise<Allocation[]> {
  const invoices = await tx.invoice.findMany({
    where: {
      tenantId,
      customerId,
      status: { in: ["UNPAID", "PARTIAL"] },
      ...(restrictTo?.length ? { id: { in: restrictTo } } : {}),
    },
    orderBy: { invoiceDate: "asc" },
  });
  const out: Allocation[] = [];
  let left = amount;
  for (const inv of invoices) {
    if (left <= 0.001) break;
    const balance = Number(inv.grandTotal) - Number(inv.amountPaid) - Number(inv.creditedAmount);
    const take = Math.min(left, balance);
    if (take > 0) { out.push({ invoiceId: inv.id, amount: Number(take.toFixed(2)) }); left -= take; }
  }
  return out;
}
