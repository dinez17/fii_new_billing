"""Produce a local, read-only preflight for the two selected legacy companies."""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path
from lisoft_source import COMPANY_COLUMNS, read_dump

def money(value):
    return Decimal(value or "0").quantize(Decimal("0.01"))

def fy(value):
    day = date.fromisoformat(value)
    start = day.year if day.month >= 4 else day.year - 1
    return f"{start}-{str(start+1)[-2:]}"

def audit(tables, company_id):
    data = {name: [row for row in rows if row[COMPANY_COLUMNS[name]] == company_id] for name, rows in tables.items()}
    issues = []
    parties = {row["user_cust_vendor_id"]: row for row in data["user_cust_vendor_details"]}
    metrics, years = {}, defaultdict(lambda: defaultdict(Decimal))
    for table, date_col, amount_col, id_col in [("user_bills", "billdate", "billtotamt", "billid"), ("user_receipt", "user_receipt_date", "user_payment_amount", "user_receipt_id"), ("user_purchase_bills", "billdate", "billtotamt", "billid"), ("user_purchase_receipt", "user_receipt_date", "user_payment_amount", "user_receipt_id")]:
        for row in data[table]:
            try:
                year = fy(row[date_col]); years[year][table] += money(row[amount_col])
            except ValueError:
                issues.append({"type": "invalid_date", "table": table, "id": row[id_col], "value": row[date_col]})
        metrics[table] = {"count": len(data[table]), "total": str(sum((money(row[amount_col]) for row in data[table]), Decimal(0)))}
    for header_name, line_name, receipt_name in [("user_bills", "user_bill_details", "user_receipt"), ("user_purchase_bills", "user_purchase_bill_details", "user_purchase_receipt")]:
        headers = {row["billid"]: row for row in data[header_name]}
        line_counts, line_totals, tax_totals, payments = Counter(), defaultdict(Decimal), defaultdict(Decimal), defaultdict(Decimal)
        for row in data[line_name]:
            key = row["billid"]; line_counts[key] += 1; line_totals[key] += money(row["total"])
            tax_totals[key] += sum((money(row[k]) for k in ["cgsta", "sgsta", "igsta"]), Decimal(0))
            if key not in headers:
                issues.append({"type": "orphan_invoice_line", "table": line_name, "id": row["id"], "billid": key})
        for row in data[receipt_name]:
            key = row["receipt_bill_id"]; payments[key] += money(row["user_payment_amount"])
            if key not in headers:
                issues.append({"type": "orphan_payment", "table": receipt_name, "id": row["user_receipt_id"], "billid": key})
        for key, row in headers.items():
            if row["billto"] not in parties:
                issues.append({"type": "missing_party", "table": header_name, "id": key, "party_id": row["billto"]})
            if not line_counts[key]:
                issues.append({"type": "invoice_without_lines", "table": header_name, "id": key})
            remaining = money(row["billtotamt"]) - payments[key]
            if remaining != money(row["billremamt"]):
                issues.append({"type": "payment_balance_difference", "table": header_name, "id": key, "total": row["billtotamt"], "receipts": str(payments[key]), "stored_remaining": row["billremamt"], "calculated_remaining": str(remaining)})
            if tax_totals[key] != money(row["billtaxamt"]):
                issues.append({"type": "tax_difference", "table": header_name, "id": key, "header_tax": row["billtaxamt"], "line_tax": str(tax_totals[key])})
        duplicates = Counter(row["billno"] for row in data[header_name])
        for number, count in duplicates.items():
            if count > 1:
                issues.append({"type": "duplicate_document_number", "table": header_name, "number": number, "count": count})
    phone_counts = Counter((row["user_cust_vendor_mobile"] or "").strip() for row in parties.values())
    for phone, count in phone_counts.items():
        if not phone or count > 1:
            issues.append({"type": "blank_or_shared_party_phone", "party_ids": [key for key, row in parties.items() if (row["user_cust_vendor_mobile"] or "").strip() == phone], "count": count})
    company = data["user_company_info"][0]
    return {"old_company_id": company_id, "name": company["company_name"], "row_counts": {key: len(rows) for key, rows in data.items()}, "financial_totals": metrics,
        "financial_year_totals": {year: {key: str(value) for key, value in values.items()} for year, values in sorted(years.items())},
        "bill_types": dict(Counter(row["billtype"] for row in data["user_bills"])), "bill_modes": dict(Counter(row["billmode"] for row in data["user_bills"])),
        "party_status_values": dict(Counter(row["user_cust_vendor_status"] for row in parties.values())),
        "payment_modes": dict(Counter(row["user_payment_type"] for row in data["user_receipt"])),
        "issue_counts": dict(Counter(item["type"] for item in issues)), "issues": issues}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("source"); parser.add_argument("--output", default="reports/migration/lisoft")
    args = parser.parse_args(); output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    tables = read_dump(args.source)
    report = {"source_sha256": hashlib.sha256(Path(args.source).read_bytes()).hexdigest(), "companies": [audit(tables, company) for company in ["1", "30"]]}
    (output / "selected-source.json").write_text(json.dumps(tables, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "preflight.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"companies": [{key: value for key, value in company.items() if key != "issues"} for company in report["companies"]]}, indent=2))
