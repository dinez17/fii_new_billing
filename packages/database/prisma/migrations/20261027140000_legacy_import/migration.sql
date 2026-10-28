ALTER TABLE "Customer" ALTER COLUMN "phone" DROP NOT NULL;
CREATE TABLE "LegacyRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "sourceTable" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "targetModel" TEXT,
  "targetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LegacyRecord_tenantId_sourceHash_sourceTable_sourceId_key" ON "LegacyRecord"("tenantId","sourceHash","sourceTable","sourceId");
CREATE INDEX "LegacyRecord_tenantId_status_sourceTable_idx" ON "LegacyRecord"("tenantId","status","sourceTable");
