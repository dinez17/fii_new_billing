import {describe,it,expect} from "vitest";
import {decodePurchaseDocument,parsePurchaseText} from "../src/services/purchase-document";
const text=`Example Telecom Private Limited
Tax Invoice
GSTIN: 33AAACP1234A1Z5
Invoice No: TN/26-27/123
Invoice Date: 01-11-2026
Due Date: 10-11-2026
Description  HSN/SAC  Qty  Rate  GST %  Amount
Wireless Internet  998422  1 NOS  11,016.92  18%  12,999.96
Round off: 0.04
Grand Total: 13,000.00`;
describe("purchase document draft extraction",()=>{
 it("extracts Indian dates, grouped amounts, quantity units and GST",()=>{const d=parsePurchaseText(text);expect(d).toMatchObject({billNumber:"TN/26-27/123",invoiceDate:"2026-11-01",dueDate:"2026-11-10",roundOff:0.04,expectedTotal:13000});expect(d.items).toEqual([{description:"Wireless Internet",hsnSac:"998422",quantity:1,unitPrice:11016.92,discount:0,gstRate:18}]);});
 it("does not invent missing GST or dates",()=>{const d=parsePurchaseText(text.replace("GST %  ","Tax  ").replace("01-11-2026","31-02-2026"));expect(d.invoiceDate).toBe("");expect(d.items[0].gstRate).toBe(-1);});
 it("does not turn malformed OCR totals into zero",()=>expect(parsePurchaseText(text.replace("13,000.00","13000.e0")).expectedTotal).toBeNull());
 it("supports textual month dates",()=>expect(parsePurchaseText(text.replace("01-11-2026","1-Nov-2026")).invoiceDate).toBe("2026-11-01"));
 it("keeps unreadable item tables empty for manual review",()=>expect(parsePurchaseText("Tax Invoice\nUnreadable table").items).toEqual([]));
 it("validates content signatures rather than trusting extensions",()=>{expect(()=>decodePurchaseDocument({fileName:"invoice.pdf",dataUrl:"data:application/pdf;base64,"+Buffer.from("not a pdf").toString("base64")})).toThrow(/contents/);});
 it("rejects unsupported MIME types and oversize files",()=>{expect(()=>decodePurchaseDocument({fileName:"a.svg",dataUrl:"data:image/svg+xml;base64,YQ=="})).toThrow(/PDF/);const b=Buffer.alloc(5*1024*1024+1);b.write("%PDF-");expect(()=>decodePurchaseDocument({fileName:"a.pdf",dataUrl:"data:application/pdf;base64,"+b.toString("base64")})).toThrow(/5 MB/);});
 it("sanitizes names and calculates a deterministic duplicate fingerprint",()=>{const input={fileName:"../invoice\n.pdf",dataUrl:"data:application/pdf;base64,"+Buffer.from("%PDF-fixture").toString("base64")};expect(decodePurchaseDocument(input).fileName).not.toMatch(/[/\n]/);expect(decodePurchaseDocument(input).hash).toHaveLength(64);});
});
