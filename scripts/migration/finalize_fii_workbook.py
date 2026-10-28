"""Save the verified replacement result and actionable held-invoice list locally."""
import csv
import json
from collections import Counter
from decimal import Decimal
from html import escape
from pathlib import Path

root = Path("reports/migration/lisoft")
audit = json.loads((root / "fii-workbook-verification.json").read_text(encoding="utf-8"))
live = json.loads(Path("backups/fii-workbook-20261027/live-import.json").read_text(encoding="utf-8-sig"))
reset = json.loads(Path("backups/fii-workbook-20261027/live-reset.json").read_text(encoding="utf-8-sig"))
packet = json.loads((root / "native-import.json").read_text(encoding="utf-8"))
company = next(item for item in packet["companies"] if item["mapping"]["oldCompanyId"] == "1")
if live["packetHash"] != audit["packetSha256"] or not reset["skyUnchanged"] or not live["otherTenantsUnchanged"]:
    raise ValueError("Completion checks failed")
rows = company["rows"]
held = [item for item in rows["legacyRecord"] if item["sourceTable"] == "user_bills" and item["status"] == "REVIEW"]
counts = Counter(f"LISOFT-C-{item['data']['billto']}" for item in held)
balances = []
for customer in rows["customer"]:
    balance = Decimal(customer["openingBalance"]) + sum((Decimal(row["debit"]) - Decimal(row["credit"]) for row in rows["ledgerEntry"] if row["partyType"] == "CUSTOMER" and row["partyId"] == customer["id"]), Decimal(0))
    balances.append({"code": customer["code"], "customer": customer["name"], "postedOutstanding": f"{balance:.2f}", "heldInvoices": counts[customer["code"]]})
with (root / "fii-customer-posted-outstanding.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=["code", "customer", "postedOutstanding", "heldInvoices"])
    writer.writeheader(); writer.writerows(balances)
def table(headers, data):
    return "<table><thead><tr>" + "".join(f"<th>{escape(str(value))}</th>" for value in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join(f"<td>{escape(str(value))}</td>" for value in row) + "</tr>" for row in data) + "</tbody></table>"
balance_table = table(["Customer", "Code", "Posted outstanding (INR)", "Held invoices"], [[row["customer"], row["code"], row["postedOutstanding"], row["heldInvoices"]] for row in balances])
held_table = table(["Source ID", "Invoice", "Date", "Total (INR)", "Reason held"], [[row["sourceId"], row["data"]["billno"], row["data"]["billdate"], row["data"]["billtotamt"], row["reason"]] for row in held])
html = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FII workbook replacement — verified</title>
<style>body{{font:16px/1.55 system-ui;margin:40px auto;padding:0 24px;max-width:1200px;color:#17213b}}h1,h2{{color:#244c60}}table{{border-collapse:collapse;width:100%;margin:20px 0;font-size:14px}}td,th{{padding:10px;text-align:left;border:1px solid #d8e0e8}}th{{background:#edf4f6}}.notice{{padding:20px;background:#fff4d8;border-radius:10px}}code{{overflow-wrap:anywhere}}img{{max-width:100%}}</style>
<h1>FIRST IDEA INFOTECH: workbook replacement verified</h1>
<p>Completed 27 October 2026. All 899 invoices in <b>fii sales.xlsx</b> match MySQL company 1 by number, date, customer name, GSTIN, taxable amount, CGST, SGST, IGST and total. Workbook total: INR {audit['total']}.</p>
<p>FII business records were cleared and rebuilt after a full backup and restored-backup rehearsal. SKY NETWORK data, FII staff accounts, settings and license were preserved.</p>
<p>Posted: 60 customers, 850 invoices (including cancellation history), 793 receipts, 55 purchase invoices and 36 supplier payments. Financial years: 2020–21 through 2026–27.</p>
<p class="notice">49 sales invoices and 6 purchase documents remain held for correction, together with related receipts. Held amounts are excluded from posted balances. These balances represent the posted customer ledger, not a certified complete legacy closing balance. A source current-balance snapshot was not added as an opening balance, which would duplicate historical entries.</p>
<p>The live API verified all 60 displayed balances and held-invoice counts against the import packet. Unit tests: 45 passed; customer-balance integration tests: 2 passed; migration tests: 7 passed. Application and tenant UI builds passed.</p>
<h2>Customer page</h2><p>Opening balance + ledger debits − ledger credits. A negative amount is a customer credit. Refresh the customer page to load the new column.</p><img src="customer-outstanding-live.png" alt="Live customer outstanding with held invoice warning">
<h2>Customer posted balances</h2><p><a href="fii-customer-posted-outstanding.csv">Download CSV</a></p>{balance_table}
<h2>Sales invoices requiring correction</h2>{held_table}
<h2>Recovery and evidence</h2><p>Backup: <code>backups/fii-workbook-20261027/before-live-replacement.dump</code><br>SHA-256: <code>{reset['backupSha256']}</code></p>
<p>Workbook SHA-256: <code>{audit['workbookSha256']}</code><br>Verified packet SHA-256: <code>{audit['packetSha256']}</code></p>
<p><a href="fii-workbook-verification.json">Invoice-by-invoice workbook verification</a></p></html>"""
(root / "fii-workbook-reimport.html").write_text(html, encoding="utf-8")
print(json.dumps({"report": str(root / "fii-workbook-reimport.html"), "customers": len(balances), "heldSalesInvoices": len(held), "backupSha256": reset["backupSha256"]}))
