-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "financialAccountId" TEXT;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "financialAccountId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "financialAccountId" TEXT,
ADD COLUMN     "payslipId" TEXT;

-- AlterTable
ALTER TABLE "DayBookEntry" ADD COLUMN     "financialAccountId" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "financialAccountId" TEXT;

-- CreateTable
CREATE TABLE "TdsClearing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "clearingDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsClearing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivableWriteOff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "entryDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivableWriteOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriberSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriberSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TdsClearing_journalId_key" ON "TdsClearing"("journalId");

-- CreateIndex
CREATE INDEX "TdsClearing_tenantId_paymentId_idx" ON "TdsClearing"("tenantId", "paymentId");

-- CreateIndex
CREATE INDEX "ReceivableWriteOff_tenantId_invoiceId_idx" ON "ReceivableWriteOff"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "SubscriberSchedule_tenantId_status_effectiveDate_idx" ON "SubscriberSchedule"("tenantId", "status", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_payslipId_key" ON "Expense"("payslipId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayBookEntry" ADD CONSTRAINT "DayBookEntry_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsClearing" ADD CONSTRAINT "TdsClearing_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsClearing" ADD CONSTRAINT "TdsClearing_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivableWriteOff" ADD CONSTRAINT "ReceivableWriteOff_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberSchedule" ADD CONSTRAINT "SubscriberSchedule_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

