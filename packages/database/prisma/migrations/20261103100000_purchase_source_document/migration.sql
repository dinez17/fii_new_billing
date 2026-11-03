ALTER TABLE "PurchaseInvoice" ADD COLUMN "sourceDocumentEncrypted" TEXT, ADD COLUMN "sourceDocumentHash" TEXT;
CREATE UNIQUE INDEX "PurchaseInvoice_tenantId_sourceDocumentHash_key" ON "PurchaseInvoice"("tenantId", "sourceDocumentHash");
