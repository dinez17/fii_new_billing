DROP INDEX "JournalEntry_reversalOf_key";
CREATE UNIQUE INDEX "JournalEntry_tenantId_reversalOf_key" ON "JournalEntry"("tenantId", "reversalOf");
