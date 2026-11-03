import {describe,it,expect} from "vitest";
import {parsePurchaseText} from "../src/services/purchase-document";
const text=`SB SYSTEM SERVICE
No : SBS5313       INVOICE       Date :02/10/26
To : Example Buyer
: 750 Rack - 4U Mini 1 Nos 750.00
2 1480 Lan Zone Outdoor Double 1 Nos 1480.00
Sleeve
3 6900 Camera recorder 1 Nos 6300.00
4 2680 Camera Bullet 3 Nos 8040.00
with Audio
5 2620 Camera Dome 2 Nos 5240.00
6 460 Power supply 1 Nos 460.00
7 4500 HDD - 1TB 41 Nos 4500.00
8 32 BNC Connector Pair 5 Nos 160.00
9 8 DC Pin 5 Nos 40.00
10 75 Outdoor PVC Box Heavy 5 Nos 375.00
Square
11. 1450 4G Router 1 Nos 1450.00
11    Total label unreadable : 29395.00`;
describe("photographed rate-first purchase table",()=>{
 it("extracts all 11 rows and preserves wrapped names",()=>{const d=parsePurchaseText(text);expect(d.items).toHaveLength(11);expect(d.items[1].description).toBe("Lan Zone Outdoor Double Sleeve");expect(d.items[9].description).toContain("Square");});
 it("reads the standalone serial, date and footer total",()=>expect(parsePurchaseText(text)).toMatchObject({billNumber:"SBS5313",invoiceDate:"2026-10-02",expectedTotal:29395,requiresTotalMatch:true}));
 it("does not invent GST or silently fix OCR quantities",()=>{const d=parsePurchaseText(text);expect(d.items.every(i=>i.gstRate===-1)).toBe(true);expect(d.items[6].quantity).toBe(41);expect(d.extractionWarnings.filter(w=>w.includes("differs"))).toHaveLength(2);});
});
