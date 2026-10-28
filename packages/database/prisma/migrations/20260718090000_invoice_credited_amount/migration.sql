-- Credit notes (sales returns) now settle the invoice balance directly:
-- outstanding = grandTotal - amountPaid - creditedAmount.

ALTER TABLE "Invoice" ADD COLUMN "creditedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Backfill from existing active credit notes
UPDATE "Invoice" i
SET "creditedAmount" = sub.total
FROM (
  SELECT "invoiceId", SUM("total") AS total
  FROM "CreditNote"
  WHERE "status" <> 'CANCELLED'
  GROUP BY "invoiceId"
) sub
WHERE sub."invoiceId" = i.id;

-- Recompute status for invoices affected by the backfill
UPDATE "Invoice"
SET "status" = CASE
  WHEN "amountPaid" + "creditedAmount" >= "grandTotal" - 0.001 THEN 'PAID'
  WHEN "amountPaid" + "creditedAmount" > 0.001 THEN 'PARTIAL'
  ELSE 'UNPAID'
END::"InvoiceStatus"
WHERE "status" IN ('UNPAID', 'PARTIAL', 'PAID') AND "creditedAmount" > 0;
