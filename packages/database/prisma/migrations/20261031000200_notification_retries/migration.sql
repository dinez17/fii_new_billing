ALTER TABLE "NotificationLog" ADD COLUMN "nextAttemptAt" TIMESTAMP(3), ADD COLUMN "lockedUntil" TIMESTAMP(3);
CREATE INDEX "NotificationLog_retry_idx" ON "NotificationLog" ("status", "nextAttemptAt", "lockedUntil");
