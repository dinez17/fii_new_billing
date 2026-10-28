import { Prisma, prisma } from "@fii/database";
import { badRequest, notFound, transactionPeriodFilters } from "@fii/common";
import { z } from "zod";
import { settleWithinTx } from "./settle.js";

export const paymentCreateBody = z.object({
  customerId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  mode: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "CARD"]),
  paymentDate: z.coerce.date(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  // allocations may be empty/partial — the unallocated remainder is an
  // "on account" credit that reduces outstanding (e.g. opening balance)
  allocations: z.array(z.object({
    invoiceId: z.string().uuid(),
    amount: z.coerce.number().positive(),
  })).max(50).default([]),
}).superRefine((b, ctx) => {
  const sum = b.allocations.reduce((s, a) => s + a.amount, 0);
  if (sum > b.amount + 0.001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Allocations (₹${sum.toFixed(2)}) exceed payment amount (₹${b.amount.toFixed(2)})` });
  }
  if ((b.mode === "CHEQUE" || b.mode === "BANK_TRANSFER") && !b.reference) {
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

async function activeFy(tenantId: string, date: Date) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
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
  const fy = await activeFy(tenantId, input.paymentDate);
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId } });
  if (!customer) throw notFound("Customer");

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        tenantId,
        customerId: customer.id,
        fyCode: fy.code,
        amount: new Prisma.Decimal(input.amount),
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
      mode: input.mode,
      paymentDate: input.paymentDate,
      fyCode: fy.code,
      allocations: input.allocations,
      actorId,
    });

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
