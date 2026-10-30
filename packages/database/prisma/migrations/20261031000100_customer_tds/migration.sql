ALTER TABLE "Payment" ADD COLUMN "tdsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
 ADD COLUMN "tdsSection" TEXT;
ALTER TABLE "PaymentAllocation" ADD COLUMN "tdsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tds_nonnegative" CHECK ("tdsAmount" >= 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tds_nonnegative" CHECK ("tdsAmount" >= 0);
