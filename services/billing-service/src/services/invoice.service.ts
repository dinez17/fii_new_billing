import { Prisma, allocateNumber, applyStock, prisma, termsFor } from "@fii/database";
import { badRequest, computeGst, notFound } from "@fii/common";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";
import type { z } from "zod";
import type { invoiceCreateBody, invoiceListQuery, invoiceUpdateBody } from "../validators.js";
import { assertActiveFy } from "./fy.js";

type CreateInput = z.infer<typeof invoiceCreateBody>;
type UpdateInput = z.infer<typeof invoiceUpdateBody>;
type ListQuery = z.infer<typeof invoiceListQuery>;

/** Sale stock-out for product-linked goods lines (call inside the invoice tx). */
async function saleStockOut(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceId: string,
  items: CreateInput["items"],
  actorId?: string,
): Promise<void> {
  const ids = items.filter((i) => i.productId).map((i) => i.productId!);
  if (ids.length === 0) return;
  const products = await tx.product.findMany({ where: { id: { in: ids }, tenantId } });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const it of items) {
    if (!it.productId) continue;
    const product = byId.get(it.productId);
    if (!product) throw badRequest("Unknown product on invoice line");
    if (product.isService) continue;
    const r = await applyStock(tx, {
      tenantId, productId: it.productId, type: "SALE_OUT", quantity: it.quantity,
      refType: "INVOICE", refId: invoiceId, actorId,
    });
    if (r.crossedReorder) {
      await tx.outboxEvent.create({
        data: {
          tenantId,
          topic: "stock.updated",
          eventKey: tenantId,
          payload: makeEnvelope(tenantId, {
            productId: it.productId, balance: r.balanceAfter, reorderLevel: r.reorderLevel, lowStock: true,
          }) as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
}

/** Reverses sale stock for an invoice's product lines (cancel / re-edit). */
async function reverseSaleStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceId: string,
  reason: string,
  actorId?: string,
): Promise<void> {
  const lines = await tx.invoiceItem.findMany({ where: { invoiceId, productId: { not: null } } });
  if (lines.length === 0) return;
  const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId!) }, tenantId } });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const line of lines) {
    const product = byId.get(line.productId!);
    if (!product || product.isService) continue;
    await applyStock(tx, {
      tenantId, productId: line.productId!, type: "ADJUST_IN", quantity: Number(line.quantity),
      refType: "INVOICE", refId: invoiceId, reason, actorId,
    });
  }
}

function itemRows(items: CreateInput["items"], totals: ReturnType<typeof computeGst>) {
  return items.map((it, i) => ({
    productId: it.productId,
    description: it.description,
    hsnSac: it.hsnSac,
    quantity: new Prisma.Decimal(it.quantity),
    unitPrice: new Prisma.Decimal(it.unitPrice),
    discount: new Prisma.Decimal(it.discount),
    gstRate: new Prisma.Decimal(it.gstRate),
    taxableValue: totals.lines[i].taxableValue,
    cgst: totals.lines[i].cgst,
    sgst: totals.lines[i].sgst,
    igst: totals.lines[i].igst,
    lineTotal: totals.lines[i].lineTotal,
  }));
}

export async function createInvoice(tenantId: string, actorId: string, input: CreateInput) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.stateCode) throw badRequest("Set the company GST state code in Settings → Company profile first");

  const fy = await assertActiveFy(tenantId, input.invoiceDate);

  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, isActive: true } });
  if (!customer) throw notFound("Customer");

  const placeOfSupply = customer.stateCode ?? tenant.stateCode;
  const isInterState = placeOfSupply !== tenant.stateCode;
  const defaultTerms = await termsFor(tenantId, "INVOICE");

  return prisma.$transaction(async (tx) => {
    const subscriber = input.subscriberId ? await tx.subscriber.findFirst({ where: { id: input.subscriberId, tenantId, customerId: customer.id }, select: { poNumber: true, chargeGst: true } }) : null;
    if (input.subscriberId && !subscriber) throw notFound("Subscriber");
    const chargeGst = subscriber?.chargeGst === false ? false : input.chargeGst ?? true;
    const items = chargeGst ? input.items : input.items.map((item) => ({ ...item, gstRate: 0 }));
    const totals = computeGst(items, isInterState);
    const invoiceNumber = await allocateNumber(tx, tenantId, chargeGst ? "INVOICE" : "NON_GST_INVOICE", fy.code);
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        invoiceNumber,
        invoiceType: "MANUAL",
        fyCode: fy.code,
        customerId: customer.id,
        subscriberId: input.subscriberId,
        poNumber: input.poNumber !== undefined ? input.poNumber || null : subscriber?.poNumber ?? null,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        placeOfSupply,
        gstTreatment: customer.gstTreatment,
        chargeGst,
        isInterState,
        subTotal: totals.subTotal,
        discountTotal: totals.discountTotal,
        taxableValue: totals.taxableValue,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        status: "UNPAID",
        notes: input.notes,
        terms: input.terms ?? defaultTerms,
        createdById: actorId,
        items: { create: itemRows(items, totals) },
      },
      include: { items: true, customer: { select: { name: true, phone: true } } },
    });

    await saleStockOut(tx, tenantId, invoice.id, input.items, actorId);

    await writeOutbox(tx, tenantId, TOPICS.INVOICE_CREATED, makeEnvelope(tenantId, {
      invoiceId: invoice.id,
      invoiceNumber,
      customerId: customer.id,
      invoiceDate: input.invoiceDate.toISOString(),
      fyCode: fy.code,
      grandTotal: totals.grandTotal,
      dueDate: input.dueDate.toISOString(),
    }, { actorUserId: actorId }));

    return invoice;
  });
}

export async function listInvoices(tenantId: string, q: ListQuery) {
  const where: Prisma.InvoiceWhereInput = {
    tenantId,
    ...(q.taxMode ? { chargeGst: q.taxMode === "GST" } : {}),
    ...(q.status ? { status: q.status === "OUTSTANDING" ? { in: ["UNPAID", "PARTIAL"] } : q.status } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.fyCode ? { fyCode: q.fyCode } : {}),
    ...(q.from || q.to ? { invoiceDate: { gte: q.from, lte: q.to } } : {}),
    ...(q.search
      ? {
          OR: [
            { invoiceNumber: { contains: q.search, mode: "insensitive" } },
            { poNumber: { contains: q.search, mode: "insensitive" } },
            { customer: { name: { contains: q.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total, sums] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      // invoice numbers are zero-padded within a series, so string desc = newest first
      orderBy: { invoiceNumber: "desc" },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({
      where: { AND: [where, { status: { not: "CANCELLED" } }] },
      _sum: { grandTotal: true, amountPaid: true },
    }),
  ]);
  return {
    items: items.map((invoice) => ({ ...invoice, balance: invoice.status === "CANCELLED" ? "0.00" : Prisma.Decimal.max(new Prisma.Decimal(invoice.grandTotal).sub(invoice.amountPaid).sub(invoice.creditedAmount), 0).toFixed(2) })), total, page: q.page, limit: q.limit,
    totals: {
      billed: sums._sum.grandTotal ?? 0,
      collected: sums._sum.amountPaid ?? 0,
    },
  };
}

export async function getInvoice(tenantId: string, id: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: {
      items: true,
      customer: true,
      subscriber: { select: { id: true, code: true, poNumber: true } },
      creditNotes: { where: { status: { not: "CANCELLED" } } },
      debitNotes: { where: { status: { not: "CANCELLED" } } },
      payments: { include: { payment: true } },
    },
  });
  if (!invoice) throw notFound("Invoice");
  return invoice;
}

/** Full edits retain the document number and reverse/repost stock and receivables. */
export async function updateInvoice(tenantId: string, actorId: string, id: string, input: UpdateInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({ where: { id, tenantId }, include: { items: true, payments: true, creditNotes: { where: { status: { not: "CANCELLED" } } }, debitNotes: { where: { status: { not: "CANCELLED" } } } } });
    if (!invoice) throw notFound("Invoice");
    if (input.chargeGst !== undefined && input.chargeGst !== invoice.chargeGst) throw badRequest("Invoice register cannot be changed. Cancel and create a new invoice in the correct register.");
    if (invoice.status !== "UNPAID" || invoice.payments.length || Number(invoice.amountPaid) > 0 || Number(invoice.creditedAmount) > 0) throw badRequest("Only unpaid invoices with no payments can be edited — issue a credit note instead");
    if (invoice.creditNotes.length || invoice.debitNotes.length) throw badRequest("Invoice has credit/debit notes and cannot be edited");
    await assertActiveFy(tenantId, invoice.invoiceDate);
    const invoiceDate = input.invoiceDate ?? invoice.invoiceDate;
    const dueDate = input.dueDate ?? invoice.dueDate;
    const fy = await assertActiveFy(tenantId, invoiceDate);
    if (fy.code !== invoice.fyCode) throw badRequest("Invoice must remain in its original financial year");
    if (dueDate < invoiceDate) throw badRequest("Due date must be on/after invoice date");
    const customerId = input.customerId ?? invoice.customerId;
    const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer || (customerId !== invoice.customerId && !customer.isActive)) throw notFound("Customer");
    const subscriberId = input.subscriberId !== undefined ? input.subscriberId : customerId === invoice.customerId ? invoice.subscriberId : null;
    const subscriber = subscriberId ? await tx.subscriber.findFirst({ where: { id: subscriberId, customerId, tenantId } }) : null;
    if (subscriberId && !subscriber) throw notFound("Subscriber");
    if (!input.items && customerId === invoice.customerId && invoiceDate.getTime() === invoice.invoiceDate.getTime()) {
      return tx.invoice.update({ where: { id }, data: { subscriberId, dueDate, poNumber: input.poNumber === undefined ? undefined : input.poNumber || null, notes: input.notes, terms: input.terms }, include: { items: true } });
    }
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (!tenant.stateCode) throw badRequest("Set company GST state code first");
    const placeOfSupply = customer.stateCode ?? tenant.stateCode;
    const isInterState = placeOfSupply !== tenant.stateCode;
    // Keep the saved tax treatment when editing the same subscription invoice.
    const noGst = !invoice.chargeGst;
    const sourceItems = input.items ?? invoice.items.map((item) => ({ productId: item.productId, description: item.description, hsnSac: item.hsnSac, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), discount: Number(item.discount), gstRate: Number(item.gstRate) }));
    const items = noGst ? sourceItems.map((item) => ({ ...item, gstRate: 0 })) : sourceItems;
    const totals = computeGst(items, isInterState);
    if (input.items) {
      await reverseSaleStock(tx, tenantId, id, "invoice edited — lines replaced", actorId);
      await saleStockOut(tx, tenantId, id, items, actorId);
    }
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    const updated = await tx.invoice.update({ where: { id }, data: {
      customerId, subscriberId, invoiceDate, dueDate,
      poNumber: input.poNumber === undefined ? undefined : input.poNumber || null,
      notes: input.notes, terms: input.terms,
      placeOfSupply, isInterState, gstTreatment: customer.gstTreatment, chargeGst: !noGst,
      subTotal: totals.subTotal, discountTotal: totals.discountTotal, taxableValue: totals.taxableValue,
      cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, roundOff: totals.roundOff, grandTotal: totals.grandTotal,
      items: { create: itemRows(items, totals) },
    }, include: { items: true } });
    if (customerId !== invoice.customerId || !new Prisma.Decimal(totals.grandTotal).eq(invoice.grandTotal) || invoiceDate.getTime() !== invoice.invoiceDate.getTime()) {
      await writeOutbox(tx, tenantId, TOPICS.INVOICE_UPDATED, makeEnvelope(tenantId, {
        invoiceId: id, invoiceNumber: invoice.invoiceNumber,
        before: { customerId: invoice.customerId, grandTotal: invoice.grandTotal.toFixed(2), invoiceDate: invoice.invoiceDate.toISOString(), fyCode: invoice.fyCode },
        after: { customerId, grandTotal: totals.grandTotal, invoiceDate: invoiceDate.toISOString(), fyCode: invoice.fyCode },
      }, { actorUserId: actorId }));
    }
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "INVOICE_UPDATED", entity: "Invoice", entityId: id, after: { invoiceNumber: invoice.invoiceNumber, previousTotal: invoice.grandTotal.toFixed(2), total: totals.grandTotal } } });
    return updated;
  });
}

export async function cancelInvoice(tenantId: string, actorId: string, id: string, reason: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId }, include: { payments: true } });
  if (!invoice) throw notFound("Invoice");
  if (invoice.status === "CANCELLED") throw badRequest("Already cancelled");
  if (invoice.payments.length > 0 || Number(invoice.amountPaid) > 0) {
    throw badRequest("Invoice has payments — issue a credit note instead of cancelling");
  }
  await assertActiveFy(tenantId, invoice.invoiceDate);
  return prisma.$transaction(async (tx) => {
    await reverseSaleStock(tx, tenantId, id, `invoice cancelled: ${reason}`, actorId);
    const updated = await tx.invoice.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    // reversal event so the ledger releases the receivable
    await writeOutbox(tx, tenantId, TOPICS.INVOICE_CANCELLED, makeEnvelope(tenantId, {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      grandTotal: Number(invoice.grandTotal).toFixed(2),
      reason,
    }, { actorUserId: actorId }));
    return updated;
  });
}
