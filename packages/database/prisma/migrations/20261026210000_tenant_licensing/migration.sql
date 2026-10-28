CREATE TYPE "LicenseStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');

ALTER TABLE "Tenant"
  ADD COLUMN "licenseStatus" "LicenseStatus" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "licenseStartsAt" TIMESTAMP(3),
  ADD COLUMN "licenseEndsAt" TIMESTAMP(3),
  ADD COLUMN "licenseKeyHash" TEXT,
  ADD COLUMN "maxUsers" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "maxCustomers" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" TEXT;

CREATE UNIQUE INDEX "Tenant_licenseKeyHash_key" ON "Tenant"("licenseKeyHash");

CREATE TABLE "TenantLicenseEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "planCode" TEXT NOT NULL,
  "status" "LicenseStatus" NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "maxUsers" INTEGER NOT NULL,
  "maxCustomers" INTEGER NOT NULL,
  "actorUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantLicenseEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TenantLicenseEvent_tenantId_createdAt_idx" ON "TenantLicenseEvent"("tenantId", "createdAt");
ALTER TABLE "TenantLicenseEvent" ADD CONSTRAINT "TenantLicenseEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
