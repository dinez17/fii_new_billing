ALTER TABLE "SalesDocument" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "SalesDocument" ADD COLUMN "prospect" JSONB;
