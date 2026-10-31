ALTER TABLE "TdsClearing" ADD CONSTRAINT "TdsClearing_positive_amount" CHECK (amount > 0), ADD CONSTRAINT "TdsClearing_kind" CHECK (kind IN ('APPLIED','REFUND')), ADD CONSTRAINT "TdsClearing_reversal_date" CHECK ("reversedAt" IS NULL OR "reversedAt" >= "clearingDate");
ALTER TABLE "ReceivableWriteOff" ADD CONSTRAINT "ReceivableWriteOff_positive_amount" CHECK (amount > 0), ADD CONSTRAINT "ReceivableWriteOff_reversal_date" CHECK ("reversedAt" IS NULL OR "reversedAt" >= "entryDate");
ALTER TABLE "SubscriberSchedule" ADD CONSTRAINT "SubscriberSchedule_action" CHECK (action IN ('PAUSE','RESUME','TERMINATE')), ADD CONSTRAINT "SubscriberSchedule_status" CHECK (status IN ('PENDING','APPLIED','FAILED','CANCELLED'));
CREATE UNIQUE INDEX "SubscriberSchedule_pending_day" ON "SubscriberSchedule" ("tenantId","subscriberId","effectiveDate") WHERE status='PENDING';
-- Also enforce tenant ownership on direct database writes and restore operations.
CREATE FUNCTION completion_related_tenant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE related_id text; owner_id text;
BEGIN
 related_id := to_jsonb(NEW)->>TG_ARGV[0];
 IF related_id IS NULL THEN RETURN NEW; END IF;
 EXECUTE format('SELECT "tenantId" FROM %I WHERE id=$1',TG_ARGV[1]) INTO owner_id USING related_id;
 IF owner_id IS NULL OR owner_id <> NEW."tenantId" THEN RAISE EXCEPTION 'Related financial record belongs to another tenant'; END IF;
 RETURN NEW;
END $$;
DO $$
DECLARE relation text[];
BEGIN
 FOREACH relation SLICE 1 IN ARRAY ARRAY[
  ['Payment','financialAccountId','FinancialAccount'],['SupplierPayment','financialAccountId','FinancialAccount'],['Expense','financialAccountId','FinancialAccount'],['Payslip','financialAccountId','FinancialAccount'],['DayBookEntry','financialAccountId','FinancialAccount'],
  ['Expense','payslipId','Payslip'],['TdsClearing','paymentId','Payment'],['TdsClearing','journalId','JournalEntry'],['ReceivableWriteOff','invoiceId','Invoice'],['SubscriberSchedule','subscriberId','Subscriber']
 ] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION completion_related_tenant_guard(%L,%L)',relation[1]||'_'||relation[2]||'_tenant_guard',relation[1],relation[2],relation[3]);
 END LOOP;
END $$;
