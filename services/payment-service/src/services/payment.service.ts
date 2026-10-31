import { Prisma, prisma, postCustomerPayment, moneyAccount, syncSourceJournal } from "@fii/database";
import { badRequest, notFound, transactionPeriodFilters, encryptSecret, decryptSecret } from "@fii/common";
import { z } from "zod";
import { settleWithinTx } from "./settle.js";

const money = z.coerce.number().finite().min(0).max(999999999999.99).multipleOf(0.01);
export const paymentCreateBody = z.object({
  customerId: z.string().uuid(),
  amount: money,
  tdsAmount: money.default(0),
  tdsSection: z.string().trim().max(30).optional(),
  financialAccountId: z.string().uuid().nullable().optional(),
  mode: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "CARD"]),
  paymentDate: z.coerce.date(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  // allocations may be empty/partial — the unallocated remainder is an
  // "on account" credit that reduces outstanding (e.g. opening balance)
  allocations: z.array(z.object({
    invoiceId: z.string().uuid(),
    amount: money,
    tdsAmount: money.default(0),
  })).max(50).default([]),
}).superRefine((b, ctx) => {
  if (b.amount + b.tdsAmount <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter money received or TDS deducted" });
  if (new Set(b.allocations.map(a => a.invoiceId)).size !== b.allocations.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select each invoice only once" });
  if (b.allocations.some(a => a.amount + a.tdsAmount <= 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each allocation must have cash or TDS" });
  const tds = b.allocations.reduce((sum, a) => sum + a.tdsAmount, 0);
  if (Math.abs(tds - b.tdsAmount) > 0.001) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Allocate the entire TDS amount to invoices" });
  const sum = b.allocations.reduce((s, a) => s + a.amount, 0);
  if (sum > b.amount + 0.001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Allocations (₹${sum.toFixed(2)}) exceed payment amount (₹${b.amount.toFixed(2)})` });
  }
  if ((b.mode === "CHEQUE" || b.mode === "BANK_TRANSFER") && b.amount > 0 && !b.reference) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${b.mode} payments require a reference (cheque no / UTR)` });
  }
});

export const paymentListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  customerId: z.string().uuid().optional(),
  search: z.string().optional(),
  ...transactionPeriodFilters,
  status: z.enum(["INITIATED", "SUCCESS", "FAILED", "REFUNDED"]).optional(),
});

async function activeFy(tenantId: string, date: Date, db: Prisma.TransactionClient = prisma) {
  const fy = await db.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (!fy) throw badRequest("No active financial year");
  if (fy.isLocked) throw badRequest(`FY ${fy.code} is locked`);
  if (date < fy.startDate || date > fy.endDate) throw badRequest(`Payment date must fall inside FY ${fy.code}`);
  return fy;
}

export async function createPayment(
  tenantId: string,
  actorId: string | null,
  input: z.infer<typeof paymentCreateBody>,
) {
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId } });
  if (!customer) throw notFound("Customer");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "FinancialYear" WHERE "tenantId" = ${tenantId} AND "isActive" = true FOR SHARE`;
    const fy = await activeFy(tenantId, input.paymentDate, tx);
    const payment = await tx.payment.create({
      data: {
        tenantId,
        customerId: customer.id,
        fyCode: fy.code,
        amount: new Prisma.Decimal(input.amount),
        tdsAmount: new Prisma.Decimal(input.tdsAmount),
        tdsSection: input.tdsAmount > 0 ? input.tdsSection : undefined,
        financialAccountId: await moneyAccount(tx,tenantId,input.financialAccountId,input.mode),
        mode: input.mode,
        status: "SUCCESS",
        paymentDate: input.paymentDate,
        reference: input.reference,
        notes: input.notes,
        createdById: actorId,
      },
    });

    const receipt = await settleWithinTx(tx, {
      tenantId,
      paymentId: payment.id,
      customerId: customer.id,
      amount: input.amount,
      tdsAmount: input.tdsAmount,
      mode: input.mode,
      paymentDate: input.paymentDate,
      fyCode: fy.code,
      allocations: input.allocations,
      actorId,
    });

    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "PAYMENT_CREATED", entity: "Payment", entityId: payment.id, after: { moneyReceived: input.amount, tdsDeducted: input.tdsAmount, customerId: customer.id, receiptNumber: receipt.receiptNumber } } });
    return { ...payment, receipt };
  });
}

export async function listPayments(tenantId: string, q: z.infer<typeof paymentListQuery>) {
  const where: Prisma.PaymentWhereInput = {
    tenantId,
    ...(q.fyCode ? { fyCode: q.fyCode } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.from || q.to ? { paymentDate: { gte: q.from, lte: q.to } } : {}),
    ...(q.search
      ? {
          OR: [
            { reference: { contains: q.search, mode: "insensitive" } },
            { customer: { name: { contains: q.search, mode: "insensitive" } } },
            { receipt: { receiptNumber: { contains: q.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total, sums] = await Promise.all([
    prisma.payment.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { paymentDate: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        receipt: { select: { id: true, receiptNumber: true } },
        allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { AND: [where, { status: "SUCCESS" }] }, _sum: { amount: true } }),
  ]);
  return { items, total, page: q.page, limit: q.limit, totalCollected: sums._sum.amount ?? 0 };
}

export async function getPayment(tenantId: string, id: string) {
  const payment = await prisma.payment.findFirst({
    where: { id, tenantId },
    include: {
      customer: true,
      receipt: true,
      allocations: { include: { invoice: { select: { invoiceNumber: true, grandTotal: true } } } },
    },
  });
  if (!payment) throw notFound("Payment");
  return payment;
}

export const tdsReportQuery = z.object({ fyCode: z.string().regex(/^\d{4}-\d{2}$/).optional(), customerId: z.string().uuid().optional() });
/** Recorded deductions, not proof of tax credit/deposit. Full selected FY, independent of payment-list dates. */
export async function tdsReport(tenantId: string, query: z.infer<typeof tdsReportQuery>) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, ...(query.fyCode ? { code: query.fyCode } : { isActive: true }) } });
  if (!fy) throw badRequest("Select an available financial year");
  const where: Prisma.PaymentWhereInput = { tenantId, fyCode: fy.code, status: "SUCCESS", tdsAmount: { gt: 0 }, ...(query.customerId ? { customerId: query.customerId } : {}) };
  return prisma.$transaction(async (tx) => {
    const groups = await tx.payment.groupBy({ by: ["customerId"], where, _sum: { tdsAmount: true, amount: true }, _count: true });
    const customers = await tx.customer.findMany({ where: { tenantId, id: { in: groups.map(g => g.customerId) } }, select: { id: true, code: true, name: true, gstin: true, phone: true, email: true } });
    const items = groups.map(g => ({ customer: customers.find(c => c.id === g.customerId)!, tdsAmount: g._sum.tdsAmount!.toFixed(2), moneyReceived: g._sum.amount!.toFixed(2), entries: g._count }))
      .sort((a,b) => Number(b.tdsAmount) - Number(a.tdsAmount) || a.customer.name.localeCompare(b.customer.name));
    return { financialYear: { code: fy.code, startDate: fy.startDate, endDate: fy.endDate }, items, totalTds: groups.reduce((sum,g) => sum.add(g._sum.tdsAmount ?? 0), new Prisma.Decimal(0)).toFixed(2), entries: groups.reduce((sum,g) => sum + g._count,0) };
  }, { isolationLevel: "RepeatableRead" });
}

export const reversePaymentBody = z.object({ reason: z.string().trim().min(10).max(500) });
/** Correction of a recorded receipt, not a gateway refund instruction. */
export async function reversePayment(tenantId: string, actorId: string, id: string, reason: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE "tenantId" = ${tenantId} AND id = ${id} FOR UPDATE`;
    const payment = await tx.payment.findFirst({ where: { id, tenantId }, include: { allocations: true, receipt: true } });
    if (!payment) throw notFound("Payment");
    if (payment.status !== "SUCCESS") throw badRequest("Only successful payments can be reversed; this payment may already be reversed");
    if(await tx.tdsClearing.count({where:{tenantId,paymentId:id,reversedAt:null}}))throw badRequest("Reverse this receipt’s TDS clearings before reversing the receipt");
    if (payment.gateway) throw badRequest("Gateway payments require a confirmed provider refund; they cannot be reversed as manual receipts");
    await tx.$queryRaw`SELECT id FROM "FinancialYear" WHERE "tenantId" = ${tenantId} AND code = ${payment.fyCode} FOR SHARE`;
    const fy = await activeFy(tenantId, payment.paymentDate, tx);
    if (fy.code !== payment.fyCode) throw badRequest("Payment financial year must be active and unlocked");
    if (!payment.receipt) throw badRequest("Payment has no receipt; reconcile before reversal");
    if (payment.allocations.length) await tx.$queryRaw`SELECT id FROM "Invoice" WHERE "tenantId" = ${tenantId} AND id IN (${Prisma.join(payment.allocations.map(a => a.invoiceId))}) ORDER BY id FOR UPDATE`;
    // Complete a pending original posting under the same payment lock before its reversal.
    await postCustomerPayment(tx, { tenantId, customerId: payment.customerId, paymentId: id, fyCode: payment.fyCode,
      entryDate: payment.paymentDate, amount: payment.amount.toFixed(2), tdsAmount: payment.tdsAmount.toFixed(2),
      mode: payment.mode, receiptNumber: payment.receipt.receiptNumber, actorId: payment.createdById });
    for (const allocation of payment.allocations) {
      const invoice = await tx.invoice.findFirst({ where: { tenantId, id: allocation.invoiceId, customerId: payment.customerId } });
      if (!invoice || invoice.status === "CANCELLED") throw badRequest("An allocated invoice is missing or cancelled; reconcile before reversal");
      const amountPaid = invoice.amountPaid.sub(allocation.amount).sub(allocation.tdsAmount);
      if (amountPaid.isNegative()) throw badRequest("Invoice settlement disagrees with the receipt; reconcile before reversal");
      const status = amountPaid.add(invoice.creditedAmount).gte(invoice.grandTotal) ? "PAID" : amountPaid.gt(0) ? "PARTIAL" : "UNPAID";
      await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid, status } });
    }
    await tx.ledgerEntry.create({ data: { tenantId, partyType: "CUSTOMER", partyId: payment.customerId,
      fyCode: payment.fyCode, entryDate: payment.paymentDate, entryType: "ADJUSTMENT", refType: "PAYMENT_REVERSAL", refId: id,
      refNumber: payment.receipt.receiptNumber, debit: payment.amount.add(payment.tdsAmount), narration: `Receipt reversed: ${reason}` } });
    if (payment.amount.gt(0)) await tx.dayBookEntry.create({ data: { tenantId, fyCode: payment.fyCode, entryDate: payment.paymentDate,
      type: "CASH_OUT", source: "INVOICE_PAYMENT", mode: payment.mode, financialAccountId: payment.financialAccountId, amount: payment.amount,
      refType: "PAYMENT_REVERSAL", refId: id, narration: `Receipt ${payment.receipt.receiptNumber} reversed: ${reason}`, createdById: actorId } });
    await tx.payment.update({ where: { id }, data: { status: "REFUNDED", failureReason: `REVERSED: ${reason}` } });
    await syncSourceJournal(tx,tenantId,"PAYMENT",id,actorId);
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "PAYMENT_REVERSED", entity: "Payment", entityId: id,
      before: { status: payment.status, cash: payment.amount.toFixed(2), tds: payment.tdsAmount.toFixed(2) },
      after: { status: "REFUNDED", reason, effectiveDate: payment.paymentDate.toISOString() } } });
    return { id, status: "REFUNDED", reversed: true };
  }, { timeout: 30000 });
}

export const tdsReviewBody = z.object({ verifiedAmount: money, certificateReference: z.string().trim().min(1).max(100),
  confirmedDate: z.coerce.date(), note: z.string().trim().min(10).max(500),
  certificateBase64: z.string().max(700000).optional() });
export async function saveTdsReview(tenantId: string, actorId: string, id: string, input: z.infer<typeof tdsReviewBody>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE "tenantId" = ${tenantId} AND id = ${id} FOR UPDATE`;
    const payment = await tx.payment.findFirst({ where: { tenantId, id, status: "SUCCESS", tdsAmount: { gt: 0 } } });
    if (!payment) throw notFound("Successful TDS payment");
    const cleared=await tx.tdsClearing.aggregate({where:{tenantId,paymentId:id,reversedAt:null},_sum:{amount:true}});
    if(new Prisma.Decimal(input.verifiedAmount).lt(cleared._sum.amount??0))throw badRequest("Verified credit cannot be reduced below active TDS clearings");
    if (new Prisma.Decimal(input.verifiedAmount).gt(payment.tdsAmount)) throw badRequest("Verified credit cannot exceed this receipt's TDS deduction");
    let certificate: string | undefined;
    if (input.certificateBase64) {
      const bytes = Buffer.from(input.certificateBase64, "base64");
      if (bytes.length > 500000 || bytes.subarray(0,5).toString() !== "%PDF-") throw badRequest("Attach a PDF certificate up to 500 KB");
      certificate = bytes.toString("base64");
    }
    const key = { tenantId, group: "TDS_RECONCILIATION", key: id };
    const old = await tx.setting.findUnique({ where: { tenantId_group_key: key } });
    const previous = old ? JSON.parse(decryptSecret(old.value)) : {};
    const value = { verifiedAmount: input.verifiedAmount.toFixed(2), certificateReference: input.certificateReference,
      confirmedDate: input.confirmedDate.toISOString(), note: input.note, certificateBase64: certificate ?? previous.certificateBase64,
      reviewedBy: actorId, reviewedAt: new Date().toISOString() };
    await tx.setting.upsert({ where: { tenantId_group_key: key }, create: { ...key, isSecret: true, value: encryptSecret(JSON.stringify(value)) }, update: { isSecret: true, value: encryptSecret(JSON.stringify(value)) } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "TDS_CREDIT_REVIEWED", entity: "Payment", entityId: id,
      after: { verifiedAmount: value.verifiedAmount, certificateReference: input.certificateReference, certificateAttached: !!value.certificateBase64 } } });
    return { saved: true };
  });
}
export async function tdsDetails(tenantId: string, fyCode: string, customerId: string) {
  const payments = await prisma.payment.findMany({ where: { tenantId, fyCode, customerId, status: "SUCCESS", tdsAmount: { gt: 0 } }, include: { receipt: true }, orderBy: { paymentDate: "asc" } });
  const reviews = await prisma.setting.findMany({ where: { tenantId, group: "TDS_RECONCILIATION", key: { in: payments.map(p => p.id) } } });
  return payments.map(p => { const review = reviews.find(r => r.key === p.id); return { ...p, review: review ? JSON.parse(decryptSecret(review.value)) : null }; });
}
