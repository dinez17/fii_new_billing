"""Compare source financial facts and existing live records without modifying either."""
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from audit_lisoft import money, fy
from lisoft_source import COMPANY_COLUMNS

root = Path("reports/migration/lisoft")
source = json.loads((root / "selected-source.json").read_text(encoding="utf-8"))
snapshot = json.loads((root / "target-snapshot.json").read_text(encoding="utf-8-sig"))
audit = json.loads((root / "preflight.json").read_text(encoding="utf-8"))
mapping = json.loads(Path("scripts/migration/lisoft-mapping.json").read_text())
results = []
for selected in mapping["companies"]:
    company = selected["oldCompanyId"]
    target = next(item for item in snapshot["tenants"] if item["id"] == selected["tenantId"])
    if target["subdomain"] != selected["subdomain"]:
        raise ValueError("Target tenant mapping mismatch")
    data = {name: [row for row in rows if row[COMPANY_COLUMNS[name]] == company] for name, rows in source.items()}
    issues = next(item for item in audit["companies"] if item["old_company_id"] == company)["issues"]
    bills = {row["billid"]: row for row in data["user_bills"]}
    non_cancel_no_lines = [item for item in issues if item["type"] == "invoice_without_lines" and item["table"] == "user_bills" and bills[item["id"]]["billmode"] != "CANCEL"]
    duplicates = [item for item in issues if item["type"] == "duplicate_document_number"]
    modes = defaultdict(lambda: {"count": 0, "amount": Decimal(0)})
    for row in data["user_receipt"]:
        modes[row["user_payment_type"]]["count"] += 1; modes[row["user_payment_type"]]["amount"] += money(row["user_payment_amount"])
    matches = []
    for invoice in target["invoices"]:
        for row in bills.values():
            if invoice["invoiceNumber"] == row["billno"]:
                matches.append({"target_invoice_id": invoice["id"], "legacy_billid": row["billid"], "number": row["billno"], "same_date": invoice["invoiceDate"][:10] == row["billdate"], "same_total": money(invoice["grandTotal"]) == money(row["billtotamt"])})
    receipt_numbers = Counter(row["user_receipt_no"] for row in data["user_receipt"])
    cancelled_payments = [row for row in data["user_receipt"] if bills[row["receipt_bill_id"]]["billmode"] == "CANCEL"]
    paid_vs_remaining = [item for item in issues if item["type"] == "payment_balance_difference"]
    years = defaultdict(lambda: {"invoices": 0, "cancelled": 0, "gross_including_cancelled": Decimal(0), "non_cancelled_gross": Decimal(0)})
    for row in bills.values():
        metrics = years[fy(row["billdate"])]; metrics["invoices"] += 1; metrics["gross_including_cancelled"] += money(row["billtotamt"])
        if row["billmode"] == "CANCEL": metrics["cancelled"] += 1
        else: metrics["non_cancelled_gross"] += money(row["billtotamt"])
    results.append({"company": selected, "current_target_counts": {key: len(target[key]) for key in ["customers", "invoices", "payments", "products", "purchases"]},
        "source_counts": {key: len(rows) for key, rows in data.items()}, "financial_years": {year: {key: str(value) if isinstance(value, Decimal) else value for key, value in values.items()} for year, values in sorted(years.items())},
        "existing_invoice_number_matches": matches, "source_duplicate_invoice_numbers": duplicates,
        "source_duplicate_receipt_numbers": [{"number": number, "count": count} for number, count in receipt_numbers.items() if count > 1],
        "non_cancelled_invoices_without_lines": non_cancel_no_lines,
        "receipt_modes": {mode: {"count": values["count"], "amount": str(values["amount"])} for mode, values in modes.items()},
        "payment_balance_differences": paid_vs_remaining,
        "receipts_against_cancelled_invoices": {"count": len(cancelled_payments), "amount": str(sum((money(row["user_payment_amount"]) for row in cancelled_payments), Decimal(0)))},
        "missing_party_references": [item for item in issues if item["type"] == "missing_party"],
        "other_issue_counts": dict(Counter(item["type"] for item in issues))})
(root / "reconciliation.json").write_text(json.dumps({"mode": "staging-only", "companies": results}, ensure_ascii=False, indent=2), encoding="utf-8")
for result in results:
    print(json.dumps({"company": result["company"]["name"], "existing_invoice_number_matches": len(result["existing_invoice_number_matches"]), "duplicate_invoice_numbers": len(result["source_duplicate_invoice_numbers"]), "duplicate_receipt_numbers": len(result["source_duplicate_receipt_numbers"]), "non_cancelled_invoices_without_lines": len(result["non_cancelled_invoices_without_lines"]), "balance_differences": len(result["payment_balance_differences"]), "receipt_modes": result["receipt_modes"], "missing_party_references": result["missing_party_references"], "cancelled_invoice_receipts": result["receipts_against_cancelled_invoices"]}))
