import { countNumberedDocuments, numberedDocumentIds, inDocumentOrder, Prisma, allocateNumber, prisma, termsFor } from "@fii/database";
import { badRequest, computeGst, notFound } from "@fii/common";
import { z } from "zod";
import { lineItem } from "../validators.js";
import { assertActiveFy } from "./fy.js";
import { createInvoice } from "./invoice.service.js";

export const documentBody = z.object({
  alternativePlans: z.boolean().default(false),
  kind: z.enum(["QUOTATION", "PROFORMA"]), customerId: z.string().uuid().optional(),
  prospect: z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254), phone: z.string().trim().max(30).default(""), billingAddress: z.string().trim().max(1000).default(""), stateCode: z.string().regex(/^\d{2}$/).optional() }).optional(),
  documentDate: z.coerce.date(), validUntil: z.coerce.date(), chargeGst: z.boolean(),
  poNumber: z.string().trim().max(100).optional(), subject: z.string().trim().max(200).optional(),
  notes: z.string().max(1000).optional(), terms: z.string().max(2000).optional(),
  items: z.array(lineItem.refine(item => item.discount <= item.quantity * item.unitPrice, "Discount exceeds line amount")).min(1).max(50),
  version: z.number().int().positive().optional(),
}).refine(body => !body.alternativePlans || body.kind === "QUOTATION", "Alternative plans are available only on quotations")
.refine(body => !!body.customerId !== !!body.prospect, "Select a customer or enter prospect details")
.refine(body => body.validUntil >= body.documentDate, "Validity date must be on or after document date");
export const documentQuery = z.object({
  kind: z.enum(["QUOTATION", "PROFORMA"]).optional(), status: z.enum(["OPEN", "CONVERTED", "CANCELLED"]).optional(),
  search: z.string().max(200).optional(), fyCode: z.string().max(20).optional(),
  from: z.coerce.date().optional(), to: z.preprocess(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T23:59:59.999Z" : v, z.coerce.date().optional()),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const conversionBody = z.object({
  selectedItemIndexes: z.array(z.number().int().min(0).max(49)).min(1).max(50).optional(),
  target: z.enum(["PROFORMA", "INVOICE"]), customerId: z.string().uuid().optional(), chargeGst: z.boolean(),
  documentDate: z.coerce.date(), dueDate: z.coerce.date(), version: z.number().int().positive(),
}).refine(body => body.dueDate >= body.documentDate, "Due/validity date must be on or after document date");
type Input = z.infer<typeof documentBody>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function prepared(tx: Prisma.TransactionClient, tenantId: string, input: Input) {
  const fy = await assertActiveFy(tenantId, input.documentDate, tx);
  const [tenant, customer] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    input.customerId ? tx.customer.findFirst({ where: { id: input.customerId, tenantId, isActive: true } }) : Promise.resolve(null),
  ]);
  if (input.customerId && !customer) throw notFound("Active customer");
  if (!customer && !input.prospect) throw badRequest("Enter prospect contact details");
  if (!tenant.stateCode) throw badRequest("Set the company state code in Settings first");
  const ids = input.items.flatMap(item => item.productId ? [item.productId] : []);
  if (ids.length && await tx.product.count({ where: { tenantId, id: { in: ids } } }) !== new Set(ids).size) throw badRequest("Unknown product on document line");
  const placeOfSupply = customer?.stateCode || input.prospect?.stateCode || tenant.stateCode;
  const isInterState = placeOfSupply !== tenant.stateCode;
  const totals = computeGst(input.items.map(item => ({ ...item, gstRate: input.chargeGst ? item.gstRate : 0 })), isInterState);
  if(input.alternativePlans)for(const key of ["subTotal","discountTotal","taxableValue","cgst","sgst","igst","roundOff","grandTotal"] as const)totals[key]="0.00";
  return { alternativePlans: input.alternativePlans, fyCode: fy.code, customerId: customer?.id ?? null, prospect: input.prospect ? json(input.prospect) : Prisma.DbNull, documentDate: input.documentDate, validUntil: input.validUntil,
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
  const ids=await numberedDocumentIds("QUOTATION",{...q,tenantId,documentKind:q.kind,statuses:q.status?[q.status]:undefined});
  const [items, total] = await Promise.all([prisma.salesDocument.findMany({ where:{tenantId,id:{in:ids}}, include: { customer: { select: { id: true, name: true, phone: true } }, invoice: { select: { invoiceNumber: true, status: true } } } }), countNumberedDocuments("QUOTATION",{...q,tenantId,documentKind:q.kind,statuses:q.status?[q.status]:undefined})]);
  return { items:inDocumentOrder(items,ids), total, page: q.page, limit: q.limit };
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
    const allLines = z.array(lineItem).min(1).parse(source.items);
    if(source.alternativePlans && (!input.selectedItemIndexes?.length || new Set(input.selectedItemIndexes).size!==input.selectedItemIndexes.length || input.selectedItemIndexes.some(i=>i>=allLines.length)))throw badRequest("Select the accepted plan options before converting");
    const lines = source.alternativePlans ? input.selectedItemIndexes!.map(i=>allLines[i]) : allLines;
    const customerId = source.customerId || input.customerId;
    if (input.target === "INVOICE" && !customerId) throw badRequest("Create or select the confirmed customer before invoicing");
    if (customerId && !await tx.customer.findFirst({ where: { id: customerId, tenantId, isActive: true } })) throw badRequest("Select an active customer in this tenant");
    let result: { id: string; number: string; kind: "PROFORMA" | "INVOICE" };
    if (input.target === "PROFORMA") {
      const data = await prepared(tx, tenantId, { kind: "PROFORMA", alternativePlans:false, customerId: customerId ?? undefined, prospect: customerId ? undefined : source.prospect as Input["prospect"], documentDate: input.documentDate, validUntil: input.dueDate, chargeGst: input.chargeGst, items: lines, poNumber: source.poNumber ?? undefined, subject: source.subject ?? undefined, notes: source.notes ?? undefined });
      const documentNumber = await allocateNumber(tx, tenantId, "PROFORMA_INVOICE", data.fyCode);
      const created = await tx.salesDocument.create({ data: { ...data, tenantId, kind: "PROFORMA", documentNumber, sourceDocumentId: source.id, createdById: actorId } });
      await tx.salesDocument.update({ where: { id }, data: { status: "CONVERTED", convertedDocumentId: created.id, version: { increment: 1 } } });
      result = { id: created.id, number: created.documentNumber, kind: "PROFORMA" };
    } else {
      const invoice = await createInvoice(tenantId, actorId, { customerId: customerId!, invoiceDate: input.documentDate, dueDate: input.dueDate, chargeGst: input.chargeGst, poNumber: source.poNumber, items: lines, notes: [source.notes, `From ${source.documentNumber}`].filter(Boolean).join("\n") }, tx);
      await tx.salesDocument.update({ where: { id }, data: { status: "CONVERTED", invoiceId: invoice.id, version: { increment: 1 } } });
      result = { id: invoice.id, number: invoice.invoiceNumber, kind: "INVOICE" };
    }
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "SALES_DOCUMENT_CONVERTED", entity: "SalesDocument", entityId: id, after: { ...result, chargeGst: input.chargeGst } } });
    return result;
  }, { timeout: 30_000 });
}
