ALTER TYPE "DocType" ADD VALUE 'PROFORMA_INVOICE';
CREATE TABLE "SalesDocument" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "documentNumber" TEXT NOT NULL, "fyCode" TEXT NOT NULL, "customerId" TEXT NOT NULL,
 "documentDate" TIMESTAMP(3) NOT NULL, "validUntil" TIMESTAMP(3) NOT NULL,
 "chargeGst" BOOLEAN NOT NULL DEFAULT true, "placeOfSupply" TEXT NOT NULL, "isInterState" BOOLEAN NOT NULL,
 "poNumber" TEXT, "subject" TEXT, "notes" TEXT, "terms" TEXT,
 "items" JSONB NOT NULL, "totals" JSONB NOT NULL, "grandTotal" DECIMAL(14,2) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'OPEN', "version" INTEGER NOT NULL DEFAULT 1,
 "sourceDocumentId" TEXT, "convertedDocumentId" TEXT, "invoiceId" TEXT,
 "cancelReason" TEXT, "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SalesDocument_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SalesDocument_kind_check" CHECK ("kind" IN ('QUOTATION','PROFORMA')),
 CONSTRAINT "SalesDocument_status_check" CHECK ("status" IN ('OPEN','CONVERTED','CANCELLED')),
 CONSTRAINT "SalesDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SalesDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesDocument_tenantId_documentNumber_key" ON "SalesDocument"("tenantId", "documentNumber");
CREATE UNIQUE INDEX "SalesDocument_invoiceId_key" ON "SalesDocument"("invoiceId");
CREATE INDEX "SalesDocument_tenantId_kind_documentDate_idx" ON "SalesDocument"("tenantId", "kind", "documentDate");
CREATE INDEX "SalesDocument_tenantId_customerId_idx" ON "SalesDocument"("tenantId", "customerId");
