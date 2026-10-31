import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, prisma } from "@fii/database";
import { badRequest, notFound, computeGst } from "@fii/common";

const money = z.coerce.number().finite().nonnegative().max(999999999999.99).multipleOf(0.01);
export const legacySalesBody = z.object({ customerId: z.string().uuid(), invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.coerce.date(), dueDate: z.coerce.date(), chargeGst: z.boolean(), isInterState: z.boolean(), expectedTotal: money, expectedBalance: money,
  note: z.string().trim().min(20).max(1000),
  items: z.array(z.object({ description: z.string().trim().min(1).max(300), hsnSac: z.string().max(10),
    quantity: z.coerce.number().positive().max(999999999).multipleOf(0.001), unitPrice: money, discount: money.default(0), gstRate: z.coerce.number().min(0).max(28) })).min(1).max(100),
  receipts: z.array(z.object({ sourceRecordId: z.string().uuid(), receiptNumber: z.string().trim().min(1).max(100), paymentDate: z.coerce.date(),
    amount: money, tdsAmount: money.default(0), mode: z.enum(["CASH","CHEQUE","BANK_TRANSFER","UPI","CARD"]), reference: z.string().max(100).optional() })).max(100) });
type Input = z.infer<typeof legacySalesBody>;

async function prepare(tx: Prisma.TransactionClient, tenantId: string, id: string, input: Input) {
  const record = await tx.legacyRecord.findFirst({ where: { tenantId, id, sourceTable: "user_bills", status: "REVIEW" } });
  if (!record || record.targetId) throw badRequest("Choose an unposted held sales invoice");
  const data = record.data as Record<string,unknown>;
  if (/CANCEL/i.test(String(data.billmode ?? ""))) throw badRequest("A cancelled source invoice cannot be posted as a live sale");
  const approval = await tx.setting.findUnique({ where: { tenantId_group_key: { tenantId, group: "LEGACY_REVIEW_APPROVAL", key: id } } });
  const approved = approval ? JSON.parse(approval.value) : null;
  if (!approved?.approved || approved.sourceHash !== record.sourceHash) throw badRequest("Approve the current source record before preparing its financial posting");
  const customer = await tx.customer.findFirst({ where: { tenantId, id: input.customerId } });
  if (!customer) throw notFound("Customer");
  const partyMapping = await tx.legacyRecord.findFirst({ where: { tenantId, sourceHash: record.sourceHash, sourceTable: "user_cust_vendor_details", sourceId: String(data.billto), targetId: customer.id } });
  if (!partyMapping) throw badRequest("Customer must match the imported source customer's mapping");
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.stateCode || !customer.stateCode) throw badRequest("Verify company and customer state codes before posting");
  if (input.isInterState !== (tenant.stateCode !== customer.stateCode)) throw badRequest("Interstate selection disagrees with company/customer state codes");
  if (input.dueDate < input.invoiceDate) throw badRequest("Due date must not precede invoice date");
  const years = await tx.financialYear.findMany({ where: { tenantId } });
  const year = (date: Date) => {
    const fy = years.find(f => f.startDate <= date && f.endDate >= date);
    if (!fy || fy.isLocked) throw badRequest("Every document date must have an existing unlocked financial year; locked history needs a separately reviewed operator migration");
    return fy.code;
  };
  const fyCode = year(input.invoiceDate);
  if (await tx.invoice.findFirst({ where: { tenantId, invoiceNumber: input.invoiceNumber } })) throw badRequest("Invoice number already exists; resolve the duplicate instead of importing it twice");
  const linked = await tx.legacyRecord.findMany({ where: { tenantId, sourceHash: record.sourceHash, sourceTable: "user_receipt", data: { path: ["receipt_bill_id"], equals: record.sourceId } } });
  const receiptIds = input.receipts.map(r => r.sourceRecordId);
  if (new Set(receiptIds).size !== receiptIds.length || linked.length !== receiptIds.length || linked.some(r => !receiptIds.includes(r.id) || r.status !== "REVIEW" || r.targetId)) throw badRequest("Include every held linked receipt exactly once; unrelated or already imported receipts are not allowed");
  if (new Set(input.receipts.map(r => r.receiptNumber)).size !== input.receipts.length) throw badRequest("Correct duplicate receipt numbers explicitly");
  for (const r of input.receipts) {
    year(r.paymentDate);
    if (r.paymentDate < input.invoiceDate) throw badRequest("A linked receipt predates the invoice; reconcile it separately");
    if (r.amount > 0 && ["BANK_TRANSFER","CHEQUE"].includes(r.mode) && !r.reference) throw badRequest("Bank/cheque receipts require a verified reference");
    if (await tx.receipt.findFirst({ where: { tenantId, receiptNumber: r.receiptNumber } })) throw badRequest(`Receipt ${r.receiptNumber} already exists`);
  }
  const computed = computeGst(input.items.map(i => ({ ...i, gstRate: input.chargeGst ? i.gstRate : 0 })), input.isInterState);
  const beforeRound = new Prisma.Decimal(computed.taxableValue).add(computed.cgst).add(computed.sgst).add(computed.igst);
  const roundOff = new Prisma.Decimal(input.expectedTotal).sub(beforeRound);
  if (roundOff.abs().gt(1)) throw badRequest("Verified invoice total disagrees with the corrected items/taxes by more than rounding; correct the items first");
  const totals = { ...computed, grandTotal: new Prisma.Decimal(input.expectedTotal).toFixed(2), roundOff: roundOff.toFixed(2) };
  const settlement = input.receipts.reduce((sum,r) => sum.add(r.amount).add(r.tdsAmount), new Prisma.Decimal(0));
  const balance = new Prisma.Decimal(totals.grandTotal).sub(settlement);
  if (balance.isNegative() || !balance.eq(input.expectedBalance)) throw badRequest("Corrected invoice total minus cash and TDS must exactly equal the verified balance. Write-offs must not be recorded as cash or TDS.");
  const token = createHash("sha256").update(JSON.stringify({ input, sourceHash: record.sourceHash, approval: approved, linked: linked.map(r => [r.id,r.status,r.targetId]).sort() })).digest("hex");
  return { record, customer, totals, settlement, balance, fyCode, token, year };
}
export function previewLegacySales(tenantId: string, id: string, input: Input) {
  return prisma.$transaction(async tx => {
    const p = await prepare(tx,tenantId,id,input);
    return { token: p.token, total: p.totals.grandTotal, settlement: p.settlement.toFixed(2), balance: p.balance.toFixed(2), receiptCount: input.receipts.length,
      message: "Preview only. Posting changes financial balances; no historical stock movements or email messages will be created." };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
export function postLegacySales(tenantId: string, actorId: string, id: string, input: Input, token: string, backupReference: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "LegacyRecord" WHERE "tenantId" = ${tenantId} AND id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FinancialYear" WHERE "tenantId" = ${tenantId} FOR SHARE`;
    const p = await prepare(tx,tenantId,id,input);
    if (p.token !== token) throw badRequest("Preview is stale; review the corrected document again");
    const invoice = await tx.invoice.create({ data: { tenantId, customerId: input.customerId, invoiceNumber: input.invoiceNumber,
      invoiceType: "MANUAL", fyCode: p.fyCode, invoiceDate: input.invoiceDate, dueDate: input.dueDate, placeOfSupply: p.customer.stateCode!,
      chargeGst: input.chargeGst, isInterState: input.isInterState, gstTreatment: p.customer.gstTreatment,
      subTotal: p.totals.subTotal, discountTotal: p.totals.discountTotal, taxableValue: p.totals.taxableValue,
      cgst: p.totals.cgst, sgst: p.totals.sgst, igst: p.totals.igst, roundOff: p.totals.roundOff, grandTotal: p.totals.grandTotal,
      amountPaid: p.settlement, status: p.balance.isZero() ? "PAID" : p.settlement.gt(0) ? "PARTIAL" : "UNPAID",
      notes: `Reconciled legacy source ${p.record.sourceId}. ${input.note}`, createdById: actorId,
      items: { create: input.items.map((i,index) => ({ ...i, gstRate: input.chargeGst ? i.gstRate : 0, ...p.totals.lines[index]! })) } } });
    await tx.ledgerEntry.create({ data: { tenantId, partyType: "CUSTOMER", partyId: input.customerId, fyCode: p.fyCode,
      entryDate: input.invoiceDate, entryType: "INVOICE", refType: "INVOICE", refId: invoice.id, refNumber: invoice.invoiceNumber, debit: p.totals.grandTotal, narration: "Reconciled legacy invoice" } });
    for (const r of input.receipts) {
      const fyCode = p.year(r.paymentDate), amount = new Prisma.Decimal(r.amount), tds = new Prisma.Decimal(r.tdsAmount);
      if (amount.add(tds).isZero()) {
        await tx.legacyRecord.update({ where: { id: r.sourceRecordId }, data: { status: "ARCHIVED", reason: "Reviewed zero settlement; no financial posting" } }); continue;
      }
      const payment = await tx.payment.create({ data: { tenantId, customerId: input.customerId, fyCode, amount, tdsAmount: tds,
        mode: r.mode, paymentDate: r.paymentDate, reference: r.reference, status: "SUCCESS", createdById: actorId, notes: `Reconciled legacy receipt. ${input.note}`,
        allocations: { create: { invoiceId: invoice.id, amount, tdsAmount: tds } }, receipt: { create: { tenantId, fyCode, receiptNumber: r.receiptNumber } } } });
      await tx.ledgerEntry.create({ data: { tenantId, partyType: "CUSTOMER", partyId: input.customerId, fyCode, entryDate: r.paymentDate,
        entryType: "PAYMENT", refType: "PAYMENT", refId: payment.id, refNumber: r.receiptNumber, credit: amount.add(tds), narration: "Reconciled legacy receipt; TDS is non-cash" } });
      if (amount.gt(0)) await tx.dayBookEntry.create({ data: { tenantId, fyCode, entryDate: r.paymentDate, type: "CASH_IN", source: "INVOICE_PAYMENT",
        mode: r.mode, amount, refType: "PAYMENT", refId: payment.id, narration: "Reconciled historical actual receipt", createdById: actorId } });
      await tx.legacyRecord.update({ where: { id: r.sourceRecordId }, data: { status: "IMPORTED", targetModel: "payment", targetId: payment.id, reason: "Reconciled financial posting" } });
    }
    await tx.legacyRecord.update({ where: { id }, data: { status: "IMPORTED", targetModel: "invoice", targetId: invoice.id, reason: "Reconciled financial posting" } });
    await tx.legacyRecord.updateMany({ where: { tenantId, sourceHash: p.record.sourceHash, sourceTable: "user_bill_details", status: "REVIEW", data: { path: ["billid"], equals: p.record.sourceId } },
      data: { status: "ARCHIVED", reason: `Original items retained; corrected invoice ${invoice.invoiceNumber} posted` } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "LEGACY_FINANCIAL_DOCUMENT_POSTED", entity: "LegacyRecord", entityId: id,
      after: { invoiceId: invoice.id, total: p.totals.grandTotal, settlement: p.settlement.toFixed(2), balance: p.balance.toFixed(2), note: input.note, backupReference, previewToken: token } } });
    return { invoiceId: invoice.id, balance: p.balance.toFixed(2) };
  }, { isolationLevel: "Serializable", timeout: 30000 });
}
