import { Prisma, allocateNumber, prisma, termsFor } from "@fii/database";
import { badRequest, computeGst, notFound } from "@fii/common";
import { z } from "zod";
import { lineItem } from "../validators.js";
import { assertActiveFy } from "./fy.js";
import { createInvoice } from "./invoice.service.js";

export const documentBody = z.object({
  kind: z.enum(["QUOTATION", "PROFORMA"]), customerId: z.string().uuid(),
  documentDate: z.coerce.date(), validUntil: z.coerce.date(), chargeGst: z.boolean(),
  poNumber: z.string().trim().max(100).optional(), subject: z.string().trim().max(200).optional(),
  notes: z.string().max(1000).optional(), terms: z.string().max(2000).optional(),
  items: z.array(lineItem.refine(item => item.discount <= item.quantity * item.unitPrice, "Discount exceeds line amount")).min(1).max(50),
  version: z.number().int().positive().optional(),
}).refine(body => body.validUntil >= body.documentDate, "Validity date must be on or after document date");
export const documentQuery = z.object({
  kind: z.enum(["QUOTATION", "PROFORMA"]).optional(), status: z.enum(["OPEN", "CONVERTED", "CANCELLED"]).optional(),
  search: z.string().max(200).optional(), fyCode: z.string().max(20).optional(),
  from: z.coerce.date().optional(), to: z.preprocess(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T23:59:59.999Z" : v, z.coerce.date().optional()),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const conversionBody = z.object({
  target: z.enum(["PROFORMA", "INVOICE"]), chargeGst: z.boolean(),
  documentDate: z.coerce.date(), dueDate: z.coerce.date(), version: z.number().int().positive(),
}).refine(body => body.dueDate >= body.documentDate, "Due/validity date must be on or after document date");
type Input = z.infer<typeof documentBody>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function prepared(tx: Prisma.TransactionClient, tenantId: string, input: Input) {
  const fy = await assertActiveFy(tenantId, input.documentDate, tx);
  const [tenant, customer] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    tx.customer.findFirst({ where: { id: input.customerId, tenantId, isActive: true } }),
  ]);
  if (!customer) throw notFound("Active customer");
  if (!tenant.stateCode) throw badRequest("Set the company state code in Settings first");
  const ids = input.items.flatMap(item => item.productId ? [item.productId] : []);
  if (ids.length && await tx.product.count({ where: { tenantId, id: { in: ids } } }) !== new Set(ids).size) throw badRequest("Unknown product on document line");
  const placeOfSupply = customer.stateCode || tenant.stateCode;
  const isInterState = placeOfSupply !== tenant.stateCode;
  const totals = computeGst(input.items.map(item => ({ ...item, gstRate: input.chargeGst ? item.gstRate : 0 })), isInterState);
  return { fyCode: fy.code, customerId: customer.id, documentDate: input.documentDate, validUntil: input.validUntil,
    chargeGst: input.chargeGst, placeOfSupply, isInterState, poNumber: input.poNumber, subject: input.subject,
    notes: input.notes, terms: input.terms ?? await termsFor(tenantId, input.kind === "QUOTATION" ? "QUOTATION" : "PROFORMA_INVOICE", tx),
    items: json(input.items), totals: json(totals), grandTotal: new Prisma.Decimal(totals.grandTotal) };
}

export async function createSalesDocument(tenantId: string, actorId: string, input: Input) {
  return prisma.$transaction(async tx => {
    const data = await prepared(tx, tenantId, input);
    const documentNumber = await allocateNumber(tx, tenantId, input.kind === "QUOTATION" ? "QUOTATION" : "PROFORMA_INVOICE", data.fyCode);
    const document = await tx.salesDocument.create({ data: { ...data, tenantId, kind: input.kind, documentNumber, createdById: actorId }, include: { customer: true } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "SALES_DOCUMENT_CREATED", entity: "SalesDocument", entityId: document.id, after: { documentNumber, kind: input.kind } } });
    return document;
  });
}
export async function listSalesDocuments(tenantId: string, q: z.infer<typeof documentQuery>) {
  const where: Prisma.SalesDocumentWhereInput = { tenantId, kind: q.kind, status: q.status, fyCode: q.fyCode,
    documentDate: { gte: q.from, lte: q.to },
    ...(q.search ? { OR: [{ documentNumber: { contains: q.search, mode: "insensitive" } }, { subject: { contains: q.search, mode: "insensitive" } }, { customer: { name: { contains: q.search, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([prisma.salesDocument.findMany({ where, orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.limit, take: q.limit, include: { customer: { select: { id: true, name: true, phone: true } }, invoice: { select: { invoiceNumber: true, status: true } } } }), prisma.salesDocument.count({ where })]);
  return { items, total, page: q.page, limit: q.limit };
}
export async function getSalesDocument(tenantId: string, id: string) {
  const document = await prisma.salesDocument.findFirst({ where: { tenantId, id }, include: { customer: true, invoice: { select: { invoiceNumber: true, status: true } } } });
  if (!document) throw notFound("Sales document");
  return document;
}
async function locked(tx: Prisma.TransactionClient, tenantId: string, id: string, version: number) {
  await tx.$queryRaw`SELECT id FROM "SalesDocument" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
  const document = await tx.salesDocument.findFirst({ where: { tenantId, id } });
  if (!document) throw notFound("Sales document");
  if (document.status !== "OPEN") throw badRequest("This document is already cancelled or converted. Open its resulting document instead.");
  if (document.version !== version) throw badRequest("Document changed in another tab. Refresh before continuing.");
  return document;
}
export async function updateSalesDocument(tenantId: string, actorId: string, id: string, input: Input) {
  if (!input.version) throw badRequest("Document version is required");
  return prisma.$transaction(async tx => {
    const current = await locked(tx, tenantId, id, input.version!);
    if (current.kind !== input.kind) throw badRequest("Document type cannot be changed; use Convert instead");
    await assertActiveFy(tenantId, current.documentDate, tx);
    const data = await prepared(tx, tenantId, input);
    if (data.fyCode !== current.fyCode) throw badRequest("Document must remain in its original financial year");
    const updated = await tx.salesDocument.update({ where: { id }, data: { ...data, version: { increment: 1 } }, include: { customer: true } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "SALES_DOCUMENT_UPDATED", entity: "SalesDocument", entityId: id, after: { version: updated.version } } });
    return updated;
  });
}
export async function cancelSalesDocument(tenantId: string, actorId: string, id: string, version: number, reason: string) {
  return prisma.$transaction(async tx => {
    await locked(tx, tenantId, id, version);
    const updated = await tx.salesDocument.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason, version: { increment: 1 } } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "SALES_DOCUMENT_CANCELLED", entity: "SalesDocument", entityId: id, after: { reason } } });
    return updated;
  });
}
export async function convertSalesDocument(tenantId: string, actorId: string, id: string, input: z.infer<typeof conversionBody>) {
  return prisma.$transaction(async tx => {
    const source = await locked(tx, tenantId, id, input.version);
    if (input.target === "PROFORMA" && source.kind !== "QUOTATION") throw badRequest("Only a quotation can be converted to a proforma");
    const lines = z.array(lineItem).min(1).parse(source.items);
    let result: { id: string; number: string; kind: "PROFORMA" | "INVOICE" };
    if (input.target === "PROFORMA") {
      const data = await prepared(tx, tenantId, { kind: "PROFORMA", customerId: source.customerId, documentDate: input.documentDate, validUntil: input.dueDate, chargeGst: input.chargeGst, items: lines, poNumber: source.poNumber ?? undefined, subject: source.subject ?? undefined, notes: source.notes ?? undefined });
      const documentNumber = await allocateNumber(tx, tenantId, "PROFORMA_INVOICE", data.fyCode);
      const created = await tx.salesDocument.create({ data: { ...data, tenantId, kind: "PROFORMA", documentNumber, sourceDocumentId: source.id, createdById: actorId } });
      await tx.salesDocument.update({ where: { id }, data: { status: "CONVERTED", convertedDocumentId: created.id, version: { increment: 1 } } });
      result = { id: created.id, number: created.documentNumber, kind: "PROFORMA" };
    } else {
      const invoice = await createInvoice(tenantId, actorId, { customerId: source.customerId, invoiceDate: input.documentDate, dueDate: input.dueDate, chargeGst: input.chargeGst, poNumber: source.poNumber, items: lines, notes: [source.notes, `From ${source.documentNumber}`].filter(Boolean).join("\n") }, tx);
      await tx.salesDocument.update({ where: { id }, data: { status: "CONVERTED", invoiceId: invoice.id, version: { increment: 1 } } });
      result = { id: invoice.id, number: invoice.invoiceNumber, kind: "INVOICE" };
    }
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "SALES_DOCUMENT_CONVERTED", entity: "SalesDocument", entityId: id, after: { ...result, chargeGst: input.chargeGst } } });
    return result;
  }, { timeout: 30_000 });
}
