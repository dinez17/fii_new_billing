-- Deferred checks also protect tenant restores and direct SQL writes.
CREATE FUNCTION check_balanced_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id TEXT; target_tenant TEXT; line_count INTEGER; delta NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'JournalEntry' THEN target_id := COALESCE(NEW.id, OLD.id);
  ELSE target_id := COALESCE(NEW."journalId", OLD."journalId"); END IF;
  SELECT "tenantId" INTO target_tenant FROM "JournalEntry" WHERE id = target_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COUNT(*), COALESCE(SUM(debit-credit),0) INTO line_count, delta FROM "JournalLine" WHERE "journalId" = target_id;
  IF line_count < 2 OR delta <> 0 THEN RAISE EXCEPTION 'Journal must have at least two balanced lines'; END IF;
  IF EXISTS (SELECT 1 FROM "JournalLine" l JOIN "FinancialAccount" a ON a.id = l."accountId"
    WHERE l."journalId" = target_id AND (l."tenantId" <> target_tenant OR a."tenantId" <> target_tenant))
    THEN RAISE EXCEPTION 'Cross-tenant journal account'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced_journal_header AFTER INSERT OR UPDATE ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_balanced_journal();
CREATE CONSTRAINT TRIGGER balanced_journal_lines AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_balanced_journal();
