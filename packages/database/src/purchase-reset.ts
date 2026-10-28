import type { Prisma } from "@prisma/client";
/** Maintenance only: remove supplier purchasing records without changing product stock. */
export async function clearTenantPurchases(tx: Prisma.TransactionClient, tenantId: string) {
  const counts: Record<string, number> = {};
  const topics = ["purchase.invoice.created", "supplier.payment.paid", "purchase.return.created"];
  const events = await tx.outboxEvent.findMany({ where: { tenantId, topic: { in: topics } } });
  const eventIds = events.flatMap((event) => {
    const payload = event.payload as { eventId?: string } | null;
    return payload?.eventId ? [payload.eventId] : [];
  });
  if (eventIds.length) await tx.processedEvent.createMany({ skipDuplicates: true, data: eventIds.map((eventId) => ({ consumerGroup: "ledger-worker", eventId })) });
  counts.outboxEvents = (await tx.outboxEvent.deleteMany({ where: { tenantId, topic: { in: topics } } })).count;
  counts.allocations = (await tx.supplierPaymentAllocation.deleteMany({ where: { supplierPayment: { tenantId } } })).count;
  counts.purchaseReturns = (await tx.purchaseReturn.deleteMany({ where: { tenantId } })).count;
  counts.supplierPayments = (await tx.supplierPayment.deleteMany({ where: { tenantId } })).count;
  counts.grns = (await tx.grn.deleteMany({ where: { tenantId } })).count;
  counts.purchaseInvoiceItems = (await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoice: { tenantId } } })).count;
  counts.purchaseInvoices = (await tx.purchaseInvoice.deleteMany({ where: { tenantId } })).count;
  counts.purchaseOrderItems = (await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { tenantId } } })).count;
  counts.purchaseOrders = (await tx.purchaseOrder.deleteMany({ where: { tenantId } })).count;
  counts.supplierLedger = (await tx.ledgerEntry.deleteMany({ where: { tenantId, partyType: "SUPPLIER" } })).count;
  counts.supplierDayBook = (await tx.dayBookEntry.deleteMany({ where: { tenantId, refType: { in: ["SUPPLIER_PAYMENT", "PURCHASE_INVOICE", "PURCHASE_RETURN"] } } })).count;
  counts.legacySupplierPurchase = (await tx.legacyRecord.deleteMany({ where: { tenantId, OR: [
    { sourceTable: { in: ["user_purchase_bills", "user_purchase_bill_details", "user_purchase_receipt"] } },
    { sourceTable: "user_cust_vendor_details", targetModel: "Supplier" },
  ] } })).count;
  counts.suppliers = (await tx.supplier.deleteMany({ where: { tenantId } })).count;
  return counts;
}

/** Stable IDs and financial references stay unchanged; only display SKU is replaced. */
export async function renumberProductSkus(tx: Prisma.TransactionClient, tenantId: string, apply = false) {
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
  const products = await tx.product.findMany({ where: { tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const used = new Set(products.map((product) => product.sku));
  let next = Math.max(1, ...products.filter((product) => /^PRD-\d{5,}$/.test(product.sku)).map((product) => Number(product.sku.slice(4)) + 1));
  const changes: { id: string; name: string; oldSku: string; newSku: string }[] = [];
  for (const product of products) {
    if (/^PRD-\d{5,}$/.test(product.sku)) continue;
    let sku: string;
    do { sku = `PRD-${String(next++).padStart(5, "0")}`; } while (used.has(sku));
    used.add(sku); changes.push({ id: product.id, name: product.name, oldSku: product.sku, newSku: sku });
    if (apply) await tx.product.update({ where: { id: product.id }, data: { sku } });
  }
  return { prefix: "PRD-", nextNumber: next, changes };
}
