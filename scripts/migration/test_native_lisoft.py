import json
import unittest
from decimal import Decimal
from pathlib import Path
from prepare_native_lisoft import prepare, uid

class NativeMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads(Path("reports/migration/lisoft/selected-source.json").read_text(encoding="utf-8"))
        cls.mapping = json.loads(Path("scripts/migration/lisoft-mapping.json").read_text())
        cls.packet = prepare(cls.source, cls.mapping)

    def test_source_rows_all_preserved_and_only_selected_tenants(self):
        self.assertEqual(sum(len(c["rows"]["legacyRecord"]) for c in self.packet["companies"]), 6767)
        for company in self.packet["companies"]:
            for row in company["rows"]["legacyRecord"]:
                self.assertIn(row["data"], self.source[row["sourceTable"]])
                self.assertEqual(row["tenantId"], company["mapping"]["tenantId"])
                self.assertNotIn(row["sourceTable"], ["user_info", "user_token", "db_conn_string"])

    def test_imported_invoice_balances_and_allocations_match_exactly(self):
        for company in self.packet["companies"]:
            rows = company["rows"]
            source_bills = {r["billid"]: r for r in self.source["user_bills"] if r["compid"] == company["mapping"]["oldCompanyId"]}
            for archive in rows["legacyRecord"]:
                if archive["sourceTable"] != "user_bills" or archive["status"] != "IMPORTED": continue
                invoice = next(row for row in rows["invoice"] if row["id"] == archive["targetId"])
                source = source_bills[archive["sourceId"]]
                self.assertEqual(Decimal(invoice["grandTotal"]), Decimal(source["billtotamt"]))
                if invoice["status"] == "CANCELLED": continue
                self.assertEqual(Decimal(invoice["grandTotal"]) - Decimal(invoice["amountPaid"]), Decimal(source["billremamt"]))
                allocated = sum((Decimal(a["amount"]) for a in rows["paymentAllocation"] if a["invoiceId"] == invoice["id"]), Decimal(0))
                self.assertEqual(allocated, Decimal(invoice["amountPaid"]))

    def test_held_documents_never_post_financial_rows(self):
        for company in self.packet["companies"]:
            rows = company["rows"]; tenant = company["mapping"]["tenantId"]
            native_ids = {r["id"] for model in ["invoice", "purchaseInvoice", "payment", "supplierPayment"] for r in rows[model]}
            for archive in rows["legacyRecord"]:
                if archive["status"] != "REVIEW": continue
                model = {"user_bills": "invoice", "user_purchase_bills": "purchaseInvoice", "user_receipt": "payment", "user_purchase_receipt": "supplierPayment"}.get(archive["sourceTable"])
                if model: self.assertNotIn(uid(tenant, model, archive["sourceId"]), native_ids)
            self.assertNotIn("outboxEvent", rows)

    def test_unique_keys_determinism_and_no_fabricated_phones(self):
        again = prepare(self.source, self.mapping)
        self.assertEqual(self.packet, again)
        for company in self.packet["companies"]:
            rows = company["rows"]
            for model, key in [("customer", "code"), ("product", "sku"), ("invoice", "invoiceNumber"), ("receipt", "receiptNumber"), ("supplierPayment", "voucherNumber")]:
                values = [row[key] for row in rows[model]]; self.assertEqual(len(values), len(set(values)))
            phones = [row["phone"] for row in rows["customer"] if row["phone"]]; self.assertEqual(len(phones), len(set(phones)))
            self.assertTrue(any(row["phone"] is None for row in rows["customer"]))
            self.assertTrue(all(not row["portalEnabled"] for row in rows["customer"]))

if __name__ == "__main__": unittest.main()
