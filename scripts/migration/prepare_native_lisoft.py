"""Build deterministic native records. Ambiguous financial documents stay in review."""
import hashlib
import json
import re
import uuid
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from audit_lisoft import fy
from lisoft_source import COMPANY_COLUMNS

ROOT = Path("reports/migration/lisoft")
SOURCE_HASH = "ac3341389490e32ebdbe7d409b6b5414218eef0b1973858fa01c41096613c08e"
NAMESPACE = uuid.UUID("019342a8-b856-5d3a-b492-166d908a3181")
MODEL_ORDER = ["customer", "supplier", "product", "stockMovement", "invoice", "invoiceItem", "payment", "paymentAllocation", "receipt", "purchaseInvoice", "purchaseInvoiceItem", "supplierPayment", "supplierPaymentAllocation", "ledgerEntry", "dayBookEntry", "legacyRecord"]
KEYS = {"user_company_info": "company_id", "user_cust_vendor_details": "user_cust_vendor_id", "user_product": "user_product_id", "user_bills": "billid", "user_purchase_bills": "billid", "user_receipt": "user_receipt_id", "user_purchase_receipt": "user_receipt_id", "user_quotes": "billid", "user_quotes1": "billid"}

def clean(value):
    text = str(value or "").strip()
    return None if text.lower() in ("", "null", "nil", "none", "-") else text
def dec(value): return Decimal(clean(value) or "0")
def money(value): return format(dec(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), ".2f")
def uid(tenant, model, old): return str(uuid.uuid5(NAMESPACE, f"{SOURCE_HASH}:{tenant}:{model}:{old}"))
def at(day): date.fromisoformat(day); return day + "T00:00:00.000Z"
def state(value):
    text = clean(value)
    return text.zfill(2) if text and text.isdigit() and 1 <= int(text) <= 38 else None

def prepare(source, mapping):
    result = {"sourceHash": SOURCE_HASH, "policy": "hold-conflicting-financial-documents", "sourceSnapshotDate": "2026-10-27", "companies": []}
    for selected in mapping["companies"]:
        cid, tenant = selected["oldCompanyId"], selected["tenantId"]
        data = {table: [row for row in rows if row[COMPANY_COLUMNS[table]] == cid] for table, rows in source.items()}
        rows = {model: [] for model in MODEL_ORDER}
        archive = {}
        for table, originals in data.items():
            for original in originals:
                old = original[KEYS.get(table, "id")]
                record = {"id": uid(tenant, "legacyRecord", f"{table}:{old}"), "tenantId": tenant, "sourceHash": SOURCE_HASH,
                    "sourceTable": table, "sourceId": old, "data": original, "status": "ARCHIVED", "reason": "Original source preserved; no equivalent native record", "targetModel": None, "targetId": None}
                rows["legacyRecord"].append(record); archive[(table, old)] = record
        def mark(table, old, status, reason=None, model=None, target=None):
            record = archive[(table, old)]; record.update(status=status, reason=reason, targetModel=model, targetId=target)
        parties = {row["user_cust_vendor_id"]: row for row in data["user_cust_vendor_details"]}
        sales = {row["billid"]: row for row in data["user_bills"]}
        purchases = {row["billid"]: row for row in data["user_purchase_bills"]}
        customer_ids = {key for key, row in parties.items() if "Customer" in (row["user_cust_vendor_company_type"] or "")}
        supplier_ids = {key for key, row in parties.items() if "Vendor" in (row["user_cust_vendor_company_type"] or "")}
        customer_ids.update(row["billto"] for row in sales.values() if row["billto"] in parties)
        supplier_ids.update(row["billto"] for row in purchases.values() if row["billto"] in parties)
        used_phones = set()
        for old, row in parties.items():
            prefix = "user_cust_vendor_"; raw_phone = clean(row[prefix + "mobile"])
            phone = raw_phone if raw_phone and re.fullmatch(r"[0-9+\-\s]{10,15}", raw_phone) and raw_phone not in used_phones else None
            if phone: used_phones.add(phone)
            address = ", ".join(value for value in [clean(row[prefix + "address1"]), clean(row[prefix + "address2"]), clean(row[prefix + "landmark"])] if value)
            gst = clean(row[prefix + "gst"])
            if gst: gst = gst.upper()
            note = f"Li-Soft company {cid}, party {old}. Original balance snapshot {row[prefix + 'outstanding'] or '0'} is retained in Legacy import; it is not an opening balance on top of imported history."
            if raw_phone and not phone: note += f" Legacy contact (not a unique valid primary phone): {raw_phone}."
            if old in customer_ids:
                rows["customer"].append({"id": uid(tenant, "customer", old), "tenantId": tenant, "code": f"LISOFT-C-{old}", "name": row[prefix + "name"], "phone": phone,
                    "altPhone": raw_phone if raw_phone != phone else None, "email": clean(row[prefix + "email"]), "gstin": gst, "gstTreatment": "B2B" if gst else "B2C",
                    "billingAddress": address or None, "serviceAddress": clean(row[prefix + "ship_address"]), "city": clean(row[prefix + "city"]), "stateCode": state(row[prefix + "state"]),
                    "pincode": clean(row[prefix + "pincode"]), "openingBalance": "0.00", "portalEnabled": False, "isActive": row[prefix + "status"] == "ACTIVE", "notes": note})
            if old in supplier_ids:
                rows["supplier"].append({"id": uid(tenant, "supplier", old), "tenantId": tenant, "code": f"LISOFT-S-{old}", "name": row[prefix + "name"], "phone": raw_phone,
                    "email": clean(row[prefix + "email"]), "gstin": gst, "address": address or None, "stateCode": state(row[prefix + "state"]), "openingBalance": "0.00", "isActive": row[prefix + "status"] == "ACTIVE"})
            mark("user_cust_vendor_details", old, "REVIEW" if dec(row[prefix + "outstanding"]) else "IMPORTED", "Nonzero source balance snapshot needs reconciliation; not posted as an opening balance" if dec(row[prefix + "outstanding"]) else "Customer/vendor identities preserved separately; missing/shared phones not invented", "Customer" if old in customer_ids else "Supplier", uid(tenant, "customer" if old in customer_ids else "supplier", old))
        product_ids = set()
        for row in data["user_product"]:
            old = row["user_product_id"]; product_ids.add(old); prefix = "user_product_"
            service_unit = (clean(row[prefix + "unit"]) or "NOS").lower() in {"monthly", "mo", "quaterly", "quarterly", "half-yearly", "yearly", "yr", "days", "day"}
            stock = dec(row[prefix + "stock"])
            rows["product"].append({"id": uid(tenant, "product", old), "tenantId": tenant, "sku": f"LISOFT-P-{old}", "name": row[prefix + "name"], "description": clean(row[prefix + "desc"]),
                "hsnSac": clean(row[prefix + "hsncode"]), "unit": clean(row[prefix + "unit"]) or "NOS", "purchasePrice": money(row[prefix + "purchase_price"]), "salePrice": money(row[prefix + "sell_price"]),
                "gstRate": money(max(dec(row[prefix + "cgstp"]) + dec(row[prefix + "sgstp"]), dec(row[prefix + "igstp"]))), "stockQty": str(stock), "isService": service_unit})
            if stock:
                rows["stockMovement"].append({"id": uid(tenant, "stockSnapshot", old), "tenantId": tenant, "productId": uid(tenant, "product", old), "type": "OPENING" if stock > 0 else "ADJUST_OUT", "quantity": str(abs(stock)), "balanceAfter": str(stock),
                    "refType": "LEGACY_STOCK_SNAPSHOT", "refId": uid(tenant, "legacyRecord", f"user_product:{old}"), "reason": "Stock snapshot on backup date; historical inventory movements unavailable", "createdAt": at("2026-10-27")})
            mark("user_product", old, "IMPORTED", "Source stock snapshot retained, including negative quantities; unit-based service classification needs master-data review" if service_unit else "Source stock snapshot retained; historical movements not reconstructed", "Product", uid(tenant, "product", old))
        def native_product(old): return uid(tenant, "product", old) if old in product_ids else None
        def ensure_purchase_product(line):
            found = native_product(line["product_id"])
            if found: return found
            old = f"historic-purchase-line-{line['id']}"
            product_id = uid(tenant, "product", old)
            rows["product"].append({"id": product_id, "tenantId": tenant, "sku": f"LISOFT-HIST-{line['id']}", "name": line["product_name"], "description": "Historical purchase product missing from source master; inactive reference only", "hsnSac": clean(line["hsn"]), "unit": "NOS", "purchasePrice": money(line["rate"]), "salePrice": "0.00", "gstRate": money(max(dec(line["cgstp"]) + dec(line["sgstp"]), dec(line["igstp"]))), "stockQty": "0", "isActive": False})
            return product_id
        all_years = set()
        def ledger(model, old, party_type, party_old, day, entry_type, amount, credit=False, number=None):
            value = dec(amount)
            if not value: return
            rows["ledgerEntry"].append({"id": uid(tenant, "ledgerEntry", f"{model}:{old}"), "tenantId": tenant, "partyType": party_type, "partyId": uid(tenant, "customer" if party_type == "CUSTOMER" else "supplier", party_old), "fyCode": fy(day), "entryDate": at(day),
                "entryType": entry_type, "refType": {"invoice": "INVOICE", "purchaseInvoice": "PURCHASE_INVOICE", "payment": "PAYMENT", "supplierPayment": "SUPPLIER_PAYMENT"}[model], "refId": uid(tenant, model, old), "refNumber": number, "debit": money(0 if credit else value), "credit": money(value if credit else 0), "narration": f"Imported Li-Soft {model} {number or old}; no new-business notifications"})
        def daybook(model, old, day, amount, mode, incoming):
            rows["dayBookEntry"].append({"id": uid(tenant, "dayBookEntry", f"{model}:{old}"), "tenantId": tenant, "fyCode": fy(day), "entryDate": at(day), "type": "CASH_IN" if incoming else "CASH_OUT", "source": "INVOICE_PAYMENT" if incoming else "SUPPLIER_PAYMENT", "mode": mode,
                "amount": money(amount), "refType": "PAYMENT" if incoming else "SUPPLIER_PAYMENT", "refId": uid(tenant, model, old), "narration": "Imported historical cash/bank movement"})
        held = {}
        imported_receipt_numbers = set()
        for header_table, line_table, receipt_table, is_purchase in [("user_bills", "user_bill_details", "user_receipt", False), ("user_purchase_bills", "user_purchase_bill_details", "user_purchase_receipt", True)]:
            headers = data[header_table]; lines_by_bill = defaultdict(list); receipts_by_bill = defaultdict(list)
            for line in data[line_table]: lines_by_bill[line["billid"]].append(line)
            for receipt in data[receipt_table]: receipts_by_bill[receipt["receipt_bill_id"]].append(receipt)
            active_numbers = Counter((row["billto"] if is_purchase else "", row["billno"]) for row in headers if row["billmode"] != "CANCEL")
            used_numbers = set()
            for row in sorted(headers, key=lambda value: (value["billmode"] == "CANCEL", int(value["billid"]))):
                old = row["billid"]; reasons = []; lines = lines_by_bill[old]; receipts = receipts_by_bill[old]; cancelled = row["billmode"] == "CANCEL"
                try: all_years.add(fy(row["billdate"])); at(row["duedate"])
                except ValueError: reasons.append("Invalid document/due date")
                total, remaining = dec(row["billtotamt"]), dec(row["billremamt"])
                payments = sum((dec(receipt["user_payment_amount"]) for receipt in receipts), Decimal(0))
                if row["billto"] not in (supplier_ids if is_purchase else customer_ids): reasons.append("Party missing from source master")
                if total - payments != remaining: reasons.append("Stored outstanding differs from linked settlements")
                if any(receipt["user_payment_type"] not in {"cash", "cheque", "online_transfer", "bank_transfer"} for receipt in receipts): reasons.append("TDS/write-off or unsupported non-cash settlement requires classification")
                if not cancelled and not lines: reasons.append("Active document has no lines")
                if not is_purchase and clean(row["credit_note_no"]): reasons.append("Credit-note reference lacks an independently documented credit-note amount")
                key = (row["billto"] if is_purchase else "", row["billno"])
                if not cancelled and active_numbers[key] > 1: reasons.append("Repeated active document number")
                if key in used_numbers: reasons.append("Repeated document number, including cancelled duplicate")
                for receipt in receipts:
                    try: all_years.add(fy(receipt["user_receipt_date"]))
                    except ValueError: reasons.append("Linked receipt has invalid date")
                    if dec(receipt["user_payment_amount"]) < 0: reasons.append("Negative settlement")
                tax = {name: sum((dec(line[name + "a"]) for line in lines), Decimal(0)) for name in ["cgst", "sgst", "igst"]}
                if not cancelled and abs(sum(tax.values()) - dec(row["billtaxamt"])) > Decimal("0.03"): reasons.append("Header and line tax totals disagree")
                if not cancelled and any(dec(line["qty"]) <= 0 for line in lines): reasons.append("Nonpositive historical line quantity")
                if reasons:
                    reason = "; ".join(dict.fromkeys(reasons)); held[f"{header_table}:{old}"] = reason
                    mark(header_table, old, "REVIEW", reason)
                    for line in lines: mark(line_table, line["id"], "REVIEW", "Parent document held: " + reason)
                    for receipt in receipts: mark(receipt_table, receipt["user_receipt_id"], "REVIEW", "Linked document held: " + reason)
                    continue
                used_numbers.add(key)
                model = "purchaseInvoice" if is_purchase else "invoice"; record_id = uid(tenant, model, old); day = row["billdate"]
                discount = dec(row.get("billdiscount")); taxable = dec(row["billsubamt"]) - discount
                native = {"id": record_id, "tenantId": tenant, "fyCode": fy(day), "supplierId" if is_purchase else "customerId": uid(tenant, "supplier" if is_purchase else "customer", row["billto"]), "invoiceDate": at(day), "dueDate": at(row["duedate"]),
                    "isInterState": tax["igst"] > 0, "subTotal": money(row["billsubamt"]), "discountTotal": money(discount), "taxableValue": money(taxable), **{name: money(value) for name, value in tax.items()}, "grandTotal": money(total), "amountPaid": money(0 if cancelled else payments),
                    "status": "CANCELLED" if cancelled else "PAID" if remaining == 0 else "PARTIAL" if payments > 0 else "UNPAID", "createdAt": at(day)}
                if is_purchase: native.update(billNumber=row["billno"], ourNumber=f"LISOFT-PI/{fy(day)}/{old}")
                else:
                    party = parties[row["billto"]]
                    native.update(invoiceNumber=row["billno"], invoiceType="MANUAL", placeOfSupply=state(party["user_cust_vendor_state"]) or "00", gstTreatment="B2B" if clean(party["user_cust_vendor_gst"]) else "B2C", roundOff=money(total - taxable - sum(tax.values())),
                        notes=f"Li-Soft company {cid}, invoice ID {old}. Source remaining {money(remaining)}. Import does not certify historical stock or accounting completeness.", terms=clean(row["terms"]), cancelledAt=at(day) if cancelled else None, cancelReason="Cancelled in legacy source" if cancelled else None)
                rows[model].append(native); mark(header_table, old, "IMPORTED", "Historical document copied without recalculating original totals", model, record_id)
                for line in lines:
                    line_total = dec(line["total"]); line_tax = sum((dec(line[field]) for field in ["cgsta", "sgsta", "igsta"]), Decimal(0))
                    child_model = "purchaseInvoiceItem" if is_purchase else "invoiceItem"
                    child = {"id": uid(tenant, child_model, line["id"]), "purchaseInvoiceId" if is_purchase else "invoiceId": record_id, "productId": ensure_purchase_product(line) if is_purchase else native_product(line["product_id"]),
                        "hsnSac": clean(line["hsn"]), "quantity": str(dec(line["qty"])), "unitPrice": money(line["rate"]), "discount": "0.00", "taxableValue": money(line_total - line_tax), "gstRate": money(max(dec(line["cgstp"]) + dec(line["sgstp"]), dec(line["igstp"]))),
                        "cgst": money(line["cgsta"]), "sgst": money(line["sgsta"]), "igst": money(line["igsta"]), "lineTotal": money(line_total)}
                    if not is_purchase: child["description"] = " - ".join(value for value in [clean(line["product_name"]), clean(line["product_desc"])] if value)
                    rows[child_model].append(child); mark(line_table, line["id"], "IMPORTED", None, child_model, child["id"])
                if not cancelled: ledger(model, old, "SUPPLIER" if is_purchase else "CUSTOMER", row["billto"], day, "PURCHASE_INVOICE" if is_purchase else "INVOICE", total, credit=is_purchase, number=row["billno"])
                for receipt in receipts:
                    rid = receipt["user_receipt_id"]; amount = dec(receipt["user_payment_amount"]); receipt_day = receipt["user_receipt_date"]
                    if amount == 0:
                        mark(receipt_table, rid, "ARCHIVED", "Zero-amount legacy receipt retained without cash/ledger posting"); continue
                    mode = {"cash": "CASH", "cheque": "CHEQUE", "online_transfer": "BANK_TRANSFER", "bank_transfer": "BANK_TRANSFER"}[receipt["user_payment_type"]]
                    pay_model = "supplierPayment" if is_purchase else "payment"; pay_id = uid(tenant, pay_model, rid)
                    note = f"Li-Soft company {cid}, receipt ID {rid}, original number {receipt['user_receipt_no']}. {clean(receipt['user_payment_note']) or ''}"
                    original_number = receipt["user_receipt_no"]; number = original_number
                    if (is_purchase, number) in imported_receipt_numbers: number = f"{original_number}~L{rid}"
                    imported_receipt_numbers.add((is_purchase, number))
                    payment = {"id": pay_id, "tenantId": tenant, "supplierId" if is_purchase else "customerId": uid(tenant, "supplier" if is_purchase else "customer", row["billto"]), "fyCode": fy(receipt_day), "amount": money(amount), "mode": mode, "paymentDate": at(receipt_day), "reference": original_number, "notes": note, "createdAt": at(receipt_day)}
                    if is_purchase: payment["voucherNumber"] = number
                    else: payment["status"] = "SUCCESS"
                    rows[pay_model].append(payment)
                    allocation_model = "supplierPaymentAllocation" if is_purchase else "paymentAllocation"
                    rows[allocation_model].append({"id": uid(tenant, allocation_model, rid), "supplierPaymentId" if is_purchase else "paymentId": pay_id, "purchaseInvoiceId" if is_purchase else "invoiceId": record_id, "amount": money(amount)})
                    if not is_purchase: rows["receipt"].append({"id": uid(tenant, "receipt", rid), "tenantId": tenant, "receiptNumber": number, "fyCode": fy(receipt_day), "paymentId": pay_id, "createdAt": at(receipt_day)})
                    mark(receipt_table, rid, "IMPORTED", "Original number retained in payment reference/archive; repeated numbers receive a unique ~L suffix internally" if number != original_number else None, pay_model, pay_id)
                    ledger(pay_model, rid, "SUPPLIER" if is_purchase else "CUSTOMER", row["billto"], receipt_day, "SUPPLIER_PAYMENT" if is_purchase else "PAYMENT", amount, credit=not is_purchase, number=number)
                    daybook(pay_model, rid, receipt_day, amount, mode, not is_purchase)
        # Include fiscal-year history even when a document is held or only archived.
        for table, field in [("user_quotes", "billdate"), ("user_quotes1", "billdate"), ("user_receipt", "user_receipt_date"), ("user_purchase_receipt", "user_receipt_date")]:
            for row in data[table]:
                try: all_years.add(fy(row[field]))
                except ValueError: pass
        summary = {"name": selected["name"], "oldCompanyId": cid, "tenantId": tenant, "subdomain": selected["subdomain"], "financialYears": sorted(all_years), "nativeCounts": {model: len(records) for model, records in rows.items()},
            "archiveStatusCounts": dict(Counter(record["status"] for record in rows["legacyRecord"])), "heldDocuments": held,
            "limitations": ["Historical stock movements are not available; only source stock snapshots imported", "Quotations retained in Legacy import archive; no native quotation module", "Legacy opening-balance snapshot is not posted on top of full history", "No passwords, users, portal access or recurring auto-billing imported"]}
        company_row = data["user_company_info"][0]
        defaults = {"gstin": clean(company_row["company_gst"]), "pan": clean(company_row["company_pan"]), "addressLine1": clean(company_row["company_address1"]), "addressLine2": clean(company_row["company_address2"]), "city": clean(company_row["company_city"]), "stateCode": state(company_row["company_state"]), "pincode": clean(company_row["company_pincode"]), "phone": clean(company_row["company_mobile"]), "invoiceTerms": clean(company_row["company_inv_terms"]),
            "bankName": clean(company_row["company_bank_name1"]), "bankIfsc": clean(company_row["company_bank_ifsc1"]), "bankAccountNo": clean(company_row["company_bank_acc1"]), "bankBranch": clean(company_row["company_bank_branch1"])}
        result["companies"].append({"mapping": selected, "tenantDefaults": {key: value for key, value in defaults.items() if value is not None}, "financialYears": sorted(all_years), "rows": rows, "summary": summary})
    return result

if __name__ == "__main__":
    source = json.loads((ROOT / "selected-source.json").read_text(encoding="utf-8"))
    mapping = json.loads(Path("scripts/migration/lisoft-mapping.json").read_text())
    result = prepare(source, mapping)
    packet = ROOT / "native-import.json"; packet.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "native-plan.json").write_text(json.dumps({"sourceHash": SOURCE_HASH, "packetSha256": hashlib.sha256(packet.read_bytes()).hexdigest(), "companies": [company["summary"] for company in result["companies"]]}, indent=2), encoding="utf-8")
    for company in result["companies"]: print(json.dumps({key: value for key, value in company["summary"].items() if key not in ("heldDocuments", "limitations")}))
