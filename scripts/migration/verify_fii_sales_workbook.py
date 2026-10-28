"""Read-only gate: match every workbook invoice to company 1 before reimport."""
import hashlib
import json
import sys
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import openpyxl

ROOT = Path("reports/migration/lisoft")
EXPECTED_WORKBOOK = "834b203a03483ef169fcd48ca0abcd87a6445f6649e8b6fba6ee2c6fc7e4a2d1"
EXPECTED_PACKET = "f4dfd0a5235f5780644daa14ad961f96ea8f7a77228c87af539c7ce7fd07f413"

def money(value):
    return Decimal(str(value or 0)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)

def verify(path):
    workbook_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    if workbook_hash != EXPECTED_WORKBOOK:
        raise ValueError("Workbook changed; review the new source before replacing data")
    packet_bytes = (ROOT / "native-import.json").read_bytes()
    if hashlib.sha256(packet_bytes).hexdigest() != EXPECTED_PACKET:
        raise ValueError("Previously verified import packet changed")
    source = json.loads((ROOT / "selected-source.json").read_text(encoding="utf-8"))
    packet = json.loads(packet_bytes)
    source_rows = {row["billid"]: row for row in source["user_bills"] if row["compid"] == "1"}
    parties = {row["user_cust_vendor_id"]: row for row in source["user_cust_vendor_details"] if row["user_cust_vendor_comp_id"] == "1"}
    by_number, lines = defaultdict(list), defaultdict(list)
    for row in source_rows.values():
        by_number[row["billno"]].append(row)
    for row in source["user_bill_details"]:
        if row["company_id"] == "1":
            lines[row["billid"]].append(row)
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    seen, matches, total = set(), [], Decimal(0)
    for row_number, row in enumerate(book.active.iter_rows(min_row=2, values_only=True), 2):
        if not row[1]:
            continue
        candidates = [bill for bill in by_number[row[1]] if bill["billdate"] == row[2].strftime("%Y-%m-%d") and money(bill["billtotamt"]) == money(row[12])]
        if len(candidates) != 1 or candidates[0]["billid"] in seen:
            raise ValueError(f"Ambiguous, duplicate or missing invoice at workbook row {row_number}")
        bill = candidates[0]
        party = parties.get(bill["billto"], {})
        normalize = lambda value: " ".join(str(value or "").strip().upper().split())
        if normalize(row[3]) != normalize(party.get("user_cust_vendor_name")) or normalize(row[4]) != normalize(party.get("user_cust_vendor_gst")):
            raise ValueError(f"Customer name or GSTIN differs at row {row_number}")
        if money(bill["billsubamt"]) != money(row[5]):
            raise ValueError(f"Taxable amount differs at row {row_number}")
        for field, column in [("cgsta", 7), ("sgsta", 9), ("igsta", 11)]:
            amount = sum((money(line[field]) for line in lines[bill["billid"]]), Decimal(0))
            if money(amount) != money(row[column]):
                raise ValueError(f"GST differs at row {row_number}: {field}")
        seen.add(bill["billid"])
        total += money(row[12])
        matches.append({"workbookRow": row_number, "sourceBillId": bill["billid"], "invoiceNumber": row[1], "total": str(money(row[12]))})
    book.close()
    if seen != set(source_rows) or len(seen) != 899:
        raise ValueError("Workbook does not cover all company 1 invoices")
    company = next(item for item in packet["companies"] if item["mapping"]["oldCompanyId"] == "1")
    return {"workbook": str(path), "sheet": "Sheet1", "workbookSha256": workbook_hash,
            "packetSha256": EXPECTED_PACKET, "invoiceRows": len(seen), "total": str(total),
            "allDatesTotalsTaxableAmountsAndGstMatch": True, "allCustomerNamesAndGstinsMatch": True, "receiptSource": "MySQL company 1",
            "policy": packet["policy"], "nativeCounts": company["summary"]["nativeCounts"],
            "heldDocuments": company["summary"]["heldDocuments"], "matches": matches}

if __name__ == "__main__":
    result = verify(Path(sys.argv[1]))
    (ROOT / "fii-workbook-verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key not in ("matches", "heldDocuments")}))
