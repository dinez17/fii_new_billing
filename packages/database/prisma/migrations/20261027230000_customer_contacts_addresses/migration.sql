ALTER TABLE "Customer"
  ADD COLUMN "additionalEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "stateName" TEXT,
  ADD COLUMN "installationCity" TEXT,
  ADD COLUMN "installationState" TEXT,
  ADD COLUMN "installationStateCode" TEXT,
  ADD COLUMN "installationPincode" TEXT;
