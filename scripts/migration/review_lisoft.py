"""Verify the isolated import byte-for-value and write a human review report."""
import hashlib
import html
import json
from collections import Counter, defaultdict
from pathlib import Path

root = Path("reports/migration/lisoft")
source = json.loads((root / "selected-source.json").read_text(encoding="utf-8"))
staged = json.loads((root / "staging-roundtrip.json").read_text(encoding="utf-8"))
reconciliation = json.loads((root / "reconciliation.json").read_text(encoding="utf-8"))
canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
expected = Counter((table, canonical(row)) for table, rows in source.items() for row in rows)
actual = Counter((row["table"], canonical(row["data"])) for row in staged)
assert expected == actual, "Staged values do not match selected source values"
assert {row["company_id"] for row in staged} == {1, 30}, "Unexpected company in staging"
assert not {"user_info", "user_token", "db_conn_string"}.intersection(source), "Credential tables must not be staged"
verification = {"status": "PASS", "staged_rows": len(staged), "companies": [1, 30], "all_selected_values_preserved": True, "credential_tables_excluded": True,
    "selected_data_sha256": hashlib.sha256(canonical(sorted(expected.items())).encode()).hexdigest(), "live_financial_import_performed": (root / "live-import-result.json").exists()}
(root / "verification.json").write_text(json.dumps(verification, indent=2), encoding="utf-8")

def text(value): return html.escape(str(value))
def table(headers, rows):
    return "<table><thead><tr>" + "".join(f"<th>{text(v)}</th>" for v in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join(f"<td>{text(v)}</td>" for v in row) + "</tr>" for row in rows) + "</tbody></table>"

parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><title>Legacy migration review</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#16324f;max-width:1150px;margin:35px auto;padding:0 24px}h1,h2,h3{line-height:1.2}h2{margin-top:40px;border-top:2px solid #dce5ef;padding-top:24px}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px}td,th{padding:9px;border:1px solid #dce5ef;text-align:left;vertical-align:top}th{background:#eaf1f8}.notice{padding:16px;background:#fff5dc;border-left:4px solid #d9a523}.ok{padding:14px;background:#e9f7ed}code{overflow-wrap:anywhere}details{margin:15px 0}summary{cursor:pointer;font-weight:600}</style><h1>Legacy billing migration review</h1>",
    "<p class='ok'>Isolated source import verified: 6,767 records for companies 1 and 30. Every selected value survived the staging import unchanged. Credentials and other companies were excluded.</p>",
    "<p class='notice'><strong>Live application import is on hold for financial reconciliation.</strong> The staging database preserves source rows; it does not yet populate native billing screens or ledgers. No live customer, invoice, payment, product or purchase has been changed.</p>",
    "<p>The totals below describe the backup, not a certified accounting balance. Cancelled documents and TDS/write-off settlements require explicit handling. Existing live records will be retained unless a separate replacement is requested.</p>"]
for result in reconciliation["companies"]:
    company = result["company"]; old_id = company["oldCompanyId"]
    bills = {row["billid"]: row for row in source["user_bills"] if row["compid"] == old_id}
    receipts = [row for row in source["user_receipt"] if row["receipt_comp_id"] == old_id]
    parts.extend([f"<h2>{text(company['name'])} — old company {text(old_id)}</h2><p>Target: <code>{text(company['subdomain'])}</code> · <code>{text(company['tenantId'])}</code></p>",
        table(["Existing live record", "Count"], result["current_target_counts"].items()),
        table(["Legacy record", "Count"], result["source_counts"].items()),
        "<h3>Financial-year invoice summary</h3>", table(["FY", "All invoices", "Cancelled", "Recorded gross including cancelled", "Non-cancelled gross"], [[fy, values["invoices"], values["cancelled"], values["gross_including_cancelled"], values["non_cancelled_gross"]] for fy, values in result["financial_years"].items()]),
        "<h3>Settlement types</h3>", table(["Source payment type", "Count", "Amount"], [[mode, values["count"], values["amount"]] for mode, values in result["receipt_modes"].items()]),
        "<p>TDS and bad-debt/kasar rows must not be turned into cash receipts automatically. Preserve their original classification while agreeing on the correct ledger treatment.</p>",
        "<h3>Invoice balances requiring verification</h3><p>Calculated remaining = stored invoice total minus all linked receipt/settlement amounts. Negative values mean linked receipts exceed the invoice total; they are not automatically refunds or customer credits.</p>",
        table(["Old invoice ID", "Number", "Date", "Source mode", "Invoice total", "Linked receipts", "Old displayed remaining", "Calculated remaining"], [[issue["id"], bills[issue["id"]]["billno"], bills[issue["id"]]["billdate"], bills[issue["id"]]["billmode"], issue["total"], issue["receipts"], issue["stored_remaining"], issue["calculated_remaining"]] for issue in result["payment_balance_differences"] if issue["table"] == "user_bills"]),
        "<details><summary>Reused receipt numbers (review before deduplicating)</summary>"])
    groups = defaultdict(list)
    for row in receipts: groups[row["user_receipt_no"]].append(row)
    parts.append(table(["Number", "Old receipt IDs", "Old invoice IDs", "Dates", "Amounts"], [[number, ", ".join(row["user_receipt_id"] for row in rows), ", ".join(row["receipt_bill_id"] for row in rows), ", ".join(row["user_receipt_date"] for row in rows), ", ".join(row["user_payment_amount"] for row in rows)] for number, rows in groups.items() if len(rows) > 1]))
    parts.append("</details><details><summary>Reused invoice numbers</summary>")
    groups = defaultdict(list)
    for row in bills.values(): groups[row["billno"]].append(row)
    parts.append(table(["Number", "Old IDs", "Modes", "Amounts"], [[number, ", ".join(row["billid"] for row in rows), ", ".join(row["billmode"] for row in rows), ", ".join(row["billtotamt"] for row in rows)] for number, rows in groups.items() if len(rows) > 1]))
    parts.append("</details>")
    parts.append(f"<p>Receipts against cancelled invoices: {text(result['receipts_against_cancelled_invoices']['count'])}, amount {text(result['receipts_against_cancelled_invoices']['amount'])}.</p>")
parts.append("<h2>Required before live conversion</h2><ol><li>Confirm invoice/payment corrections for the listed balance differences, using authoritative receipt records and customer outstanding reports from the old system.</li><li>Agree on treatment of duplicate cancelled documents, reused receipt numbers, TDS and write-offs. Do not delete or reclassify them silently.</li><li>Review customer/product matches against existing FIRST IDEA data. An absence of exact invoice-number collisions does not prove absence of duplicate business transactions.</li><li>Convert into native tables in a separate copy of the application database, reconcile by tenant and financial year, then review before live import.</li></ol><p>All financial amounts are INR. Financial years are derived using April–March boundaries. Raw source rows remain available in the isolated staging database for traceability.</p></html>")
if Path("backups/fii-reset-20261027/reset-result.json").exists():
    parts = [part.replace("No live customer, invoice, payment, product or purchase has been changed.", "Update 27 October 2026: the user-requested FII operational-data reset completed after a verified backup. Staff/settings/license were preserved and SKY NETWORK was unchanged. Historical records have not yet been imported.").replace("Existing live records will be retained unless a separate replacement is requested.", "The target-count tables below describe the pre-reset snapshot; FII business records have since been cleared by explicit user request.").replace("Existing live record", "Pre-reset live record") for part in parts]
(root / "migration-review.html").write_text("\n".join(parts), encoding="utf-8")
if (root / "live-import-result.json").exists():
    content = (root / "migration-review.html").read_text(encoding="utf-8")
    content = content.replace("<h1>Legacy billing migration review</h1>", "<h1>Legacy billing migration review</h1><p class='ok'><strong>Update: consistent records have now been imported live.</strong> Conflicting records remain unposted as requested. <a href='import-completion.html'>Open the final import report</a>. The remainder of this page retains the original preflight findings.</p>")
    content = content.replace("Historical records have not yet been imported.", "Consistent historical records have since been imported; unresolved records remain in review.")
    content = content.replace("Live application import is on hold for financial reconciliation.", "Unresolved financial documents remain on hold for reconciliation.")
    content = content.replace("it does not yet populate native billing screens or ledgers.", "consistent records now also populate native billing screens and ledgers.")
    (root / "migration-review.html").write_text(content, encoding="utf-8")
print(json.dumps(verification))
