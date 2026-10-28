import hashlib
import html
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

root = Path("reports/migration/lisoft")
packet_bytes = (root / "native-import.json").read_bytes()
packet = json.loads(packet_bytes)
result = json.loads((root / "live-import-result.json").read_text(encoding="utf-8"))
assert hashlib.sha256(packet_bytes).hexdigest() == result["packetHash"]
assert result["otherTenantsUnchanged"] is True
def esc(value): return html.escape(str(value))
def table(headers, rows): return "<table><thead><tr>" + "".join(f"<th>{esc(v)}</th>" for v in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in row) + "</tr>" for row in rows) + "</tbody></table>"
parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><title>Legacy import result</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#16324f;max-width:1100px;margin:35px auto;padding:0 24px}h2{margin-top:36px;border-top:2px solid #dce5ef;padding-top:20px}table{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0}th,td{padding:9px;border:1px solid #dce5ef;text-align:left}th{background:#eaf1f8}.ok{background:#e9f7ed;padding:16px}.warn{background:#fff3d9;padding:16px}code{overflow-wrap:anywhere}</style><h1>Legacy import completed with review holds</h1>",
    "<p class='ok'>Consistent records were imported into the live FII and SKY NETWORK tenants. All 6,767 selected source records are retained in the tenant-scoped Legacy import archive. The import did not replace staff accounts, passwords or licenses.</p>",
    "<p class='warn'>As requested, conflicting financial documents and their linked receipts remain unposted. Financial reports show the imported subset and must not yet be treated as complete historical closing balances. TDS/write-offs, duplicate references and incomplete documents also require review.</p>",
    "<p>Open <strong>Settings → Legacy import</strong> in each tenant to inspect originals and review reasons. In Invoices, choose <strong>All status</strong> and the financial year you want.</p>"]
overview = []
for company, actual in zip(packet["companies"], result["results"]):
    assert company["mapping"]["tenantId"] == actual["tenantId"]
    assert company["summary"]["nativeCounts"] == actual["counts"]
    counts = actual["counts"]
    overview.append([actual["name"], counts["customer"], counts["supplier"], counts["product"], counts["invoice"], counts["payment"], counts["purchaseInvoice"], counts["supplierPayment"], actual["heldFinancialDocuments"]])
parts.append(table(["Tenant", "Customers", "Suppliers", "Products", "Invoices", "Receipts", "Purchase bills", "Supplier payments", "Held documents"], overview))
for company in packet["companies"]:
    parts.append(f"<h2>{esc(company['mapping']['name'])}</h2><p>Preserved source financial years: {esc(', '.join(company['financialYears']))}. Past years are locked; the current financial year remains available for new work.</p>")
    years = defaultdict(lambda: {"invoices": 0, "gross": Decimal(0), "paid": Decimal(0), "cancelled": 0})
    for invoice in company["rows"]["invoice"]:
        year = years[invoice["fyCode"]]; year["invoices"] += 1
        if invoice["status"] == "CANCELLED": year["cancelled"] += 1
        else: year["gross"] += Decimal(invoice["grandTotal"]); year["paid"] += Decimal(invoice["amountPaid"])
    parts.append(table(["FY", "Imported invoices", "Cancelled", "Non-cancelled total", "Allocated paid", "Imported outstanding"], [[fy, values["invoices"], values["cancelled"], f"{values['gross']:.2f}", f"{values['paid']:.2f}", f"{values['gross']-values['paid']:.2f}"] for fy, values in sorted(years.items())]))
    archives = {(row["sourceTable"], row["sourceId"]): row for row in company["rows"]["legacyRecord"]}
    held = []
    for key, reason in company["summary"]["heldDocuments"].items():
        source_table, old_id = key.split(":"); source = archives[(source_table, old_id)]["data"]
        held.append([source_table, old_id, source["billno"], source["billdate"], source["billtotamt"], reason])
    parts.append("<details><summary>Held financial documents and reasons</summary>" + table(["Type", "Old ID", "Original number", "Date", "Total", "Review reason"], held) + "</details>")
parts.append("<h2>Important retained limitations</h2><ul><li>Quotations remain in the original-record archive because the application has no native quotation module.</li><li>Current stock snapshots, including negative source quantities, were preserved. Historical inventory movements were not available and were not fabricated.</li><li>Reused receipt numbers have unique internal suffixes; their original numbers remain in payment references and source data.</li><li>Missing phones stay missing. No customer accounts/passwords or recurring auto-billing schedules were imported.</li><li>Imported historical invoices are excluded from automatic reminders. No historical notifications were emitted by the import.</li></ul><h2>Verification</h2><p>Passed: deterministic conversion, seven migration tests, 45 unit tests, 29 integration tests, isolated native rehearsal and repeat, per-model counts, money totals, payment allocations, source-value preservation, tenant isolation, live customer/invoice/payment APIs and historical invoice PDF, plus browser checks of the archive and old financial-year invoices.</p>")
parts.append(f"<p>Import packet SHA-256: <code>{esc(result['packetHash'])}</code></p><p>Restorable pre-import backup: <code>backups/lisoft-import-20261027/before-native-live-import.dump</code>. Detailed result: <code>reports/migration/lisoft/live-import-result.json</code>.</p></html>")
(root / "import-completion.html").write_text("\n".join(parts), encoding="utf-8")
print("Verified live result and saved import-completion.html")
