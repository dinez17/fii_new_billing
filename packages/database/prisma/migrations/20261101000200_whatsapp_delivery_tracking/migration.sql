ALTER TABLE "NotificationLog" ADD COLUMN "dedupeKey" TEXT, ADD COLUMN "providerMessageId" TEXT, ADD COLUMN "providerStatus" TEXT, ADD COLUMN "providerPolls" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "requiresReview" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "NotificationLog_tenantId_dedupeKey_key" ON "NotificationLog" ("tenantId", "dedupeKey");
