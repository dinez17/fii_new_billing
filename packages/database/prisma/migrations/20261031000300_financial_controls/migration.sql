CREATE TABLE "FinancialAccount" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
 "type" TEXT NOT NULL CHECK ("type" IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
 "isMoneyAccount" BOOLEAN NOT NULL DEFAULT false, "isActive" BOOLEAN NOT NULL DEFAULT true,
 CONSTRAINT "FinancialAccount_money_type" CHECK (NOT "isMoneyAccount" OR "type" = 'ASSET')
);
CREATE UNIQUE INDEX "FinancialAccount_tenantId_code_key" ON "FinancialAccount"("tenantId","code");
CREATE TABLE "JournalEntry" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "fyCode" TEXT NOT NULL, "entryDate" DATE NOT NULL,
 "narration" TEXT NOT NULL, "source" TEXT NOT NULL DEFAULT 'MANUAL', "sourceId" TEXT,
 "reversalOf" TEXT, "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "JournalEntry_reversalOf_key" ON "JournalEntry"("reversalOf");
CREATE UNIQUE INDEX "JournalEntry_tenantId_source_sourceId_key" ON "JournalEntry"("tenantId","source","sourceId");
CREATE INDEX "JournalEntry_tenantId_fyCode_entryDate_idx" ON "JournalEntry"("tenantId","fyCode","entryDate");
CREATE TABLE "JournalLine" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "journalId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
 "debit" DECIMAL(14,2) NOT NULL DEFAULT 0, "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
 CONSTRAINT "JournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "JournalLine_one_side" CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
);
CREATE INDEX "JournalLine_tenantId_accountId_idx" ON "JournalLine"("tenantId","accountId");
CREATE TABLE "BankStatementLine" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "statementDate" DATE NOT NULL,
 "reference" TEXT NOT NULL, "narration" TEXT NOT NULL, "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "credit" DECIMAL(14,2) NOT NULL DEFAULT 0, "importKey" TEXT NOT NULL, "journalLineId" TEXT,
 "reconciledById" TEXT, "reconciledAt" TIMESTAMP(3),
 CONSTRAINT "BankStatementLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankStatementLine_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "BankStatementLine_one_side" CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
);
CREATE UNIQUE INDEX "BankStatementLine_journalLineId_key" ON "BankStatementLine"("journalLineId");
CREATE UNIQUE INDEX "BankStatementLine_tenantId_accountId_importKey_key" ON "BankStatementLine"("tenantId","accountId","importKey");
CREATE INDEX "BankStatementLine_tenantId_accountId_statementDate_idx" ON "BankStatementLine"("tenantId","accountId","statementDate");
