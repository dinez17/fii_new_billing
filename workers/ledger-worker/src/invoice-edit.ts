import { prisma, Prisma } from "@fii/database";
import type { EventEnvelope } from "@fii/kafka";
export interface InvoiceEdit {
  invoiceId: string; invoiceNumber: string;
  before: { customerId: string; grandTotal: string; invoiceDate: string; fyCode: string };
  after: { customerId: string; grandTotal: string; invoiceDate: string; fyCode: string };
}
/** Append a reversal and replacement, atomically and safely on redelivery. */
export async function postInvoiceEdit(event: EventEnvelope<InvoiceEdit>) {
  const p = event.payload;
  await prisma.ledgerEntry.createMany({ skipDuplicates: true, data: [
    { id: `${event.eventId}:before`, tenantId: event.tenantId, partyType: "CUSTOMER", partyId: p.before.customerId, fyCode: p.before.fyCode, entryDate: new Date(p.before.invoiceDate), entryType: "ADJUSTMENT", refType: "INVOICE_EDIT", refId: p.invoiceId, refNumber: p.invoiceNumber, credit: new Prisma.Decimal(p.before.grandTotal), narration: `Invoice ${p.invoiceNumber} edited — reverse previous amount` },
    { id: `${event.eventId}:after`, tenantId: event.tenantId, partyType: "CUSTOMER", partyId: p.after.customerId, fyCode: p.after.fyCode, entryDate: new Date(p.after.invoiceDate), entryType: "ADJUSTMENT", refType: "INVOICE_EDIT", refId: p.invoiceId, refNumber: p.invoiceNumber, debit: new Prisma.Decimal(p.after.grandTotal), narration: `Invoice ${p.invoiceNumber} edited — revised amount` },
  ] });
}
