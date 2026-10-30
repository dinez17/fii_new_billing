ALTER TABLE "BillingRun" ADD COLUMN "taxMode" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "BillingRun" ADD CONSTRAINT "BillingRun_taxMode_check" CHECK ("taxMode" IN ('ALL', 'GST', 'WITHOUT_GST'));
DROP INDEX "BillingRun_tenantId_cycleType_periodStart_key";
CREATE UNIQUE INDEX "BillingRun_tenantId_cycleType_periodStart_taxMode_key" ON "BillingRun"("tenantId", "cycleType", "periodStart", "taxMode");
