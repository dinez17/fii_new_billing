import {describe,it,expect} from "vitest";
import {computePurchaseGst} from "../src/gst";
describe("supplier GST rounding",()=>{
 it("preserves normal paise rounding by default",()=>{const t=computePurchaseGst([{quantity:1,unitPrice:8898,gstRate:18}],false);expect(t.cgst).toBe("800.82");expect(t.roundOff).toBe("0.36");});
 it("matches explicit whole-rupee GST on a supplier bill",()=>{const t=computePurchaseGst([{quantity:1,unitPrice:8898,gstRate:18}],false,"WHOLE_RUPEE");expect(t.cgst).toBe("801.00");expect(t.sgst).toBe("801.00");expect(t.roundOff).toBe("0.00");expect(t.grandTotal).toBe("10500.00");});
 it("keeps invoice and item sums equal without negative small taxes",()=>{const t=computePurchaseGst(Array.from({length:4},()=>({quantity:1,unitPrice:1.11,gstRate:18})),false,"WHOLE_RUPEE");expect(t.lines.every(l=>Number(l.cgst)>=0&&Number(l.sgst)>=0)).toBe(true);expect(t.lines.reduce((n,l)=>n+Number(l.cgst),0)).toBe(Number(t.cgst));});
 it("supports IGST",()=>{const t=computePurchaseGst([{quantity:1,unitPrice:8898,gstRate:18}],true,"WHOLE_RUPEE");expect(t.igst).toBe("1602.00");expect(t.cgst).toBe("0.00");});
 it("extracts GST from inclusive prices without adding it again",()=>{const t=computePurchaseGst([{quantity:1,unitPrice:118,gstRate:18}],false,"PAISE",true);expect(t.taxableValue).toBe("100.00");expect(t.cgst).toBe("9.00");expect(t.sgst).toBe("9.00");expect(t.grandTotal).toBe("118.00");});
 it("supports inclusive discounts and interstate GST",()=>{const t=computePurchaseGst([{quantity:2,unitPrice:118,discount:118,gstRate:18}],true,"PAISE",true);expect(t.taxableValue).toBe("100.00");expect(t.discountTotal).toBe("100.00");expect(t.igst).toBe("18.00");expect(t.grandTotal).toBe("118.00");});
 it("keeps the photograph's gross total unchanged at a confirmed 18 percent",()=>{const prices=[750,1480,6900,2680,2620,460,4500,32,8,75,1450],quantities=[1,1,1,3,2,1,1,5,5,5,1];const t=computePurchaseGst(prices.map((price,i)=>({quantity:quantities[i],unitPrice:price,gstRate:18})),false,"PAISE",true);expect(t.grandTotal).toBe("29395.00");expect(Number(t.taxableValue)+Number(t.cgst)+Number(t.sgst)).toBeCloseTo(29395,2);});
 it("retains gross amounts with whole-rupee supplier tax rounding",()=>{const t=computePurchaseGst([{quantity:1,unitPrice:10500,gstRate:18}],false,"WHOLE_RUPEE",true);expect(t.taxableValue).toBe("8898.00");expect(t.cgst).toBe("801.00");expect(t.sgst).toBe("801.00");expect(t.grandTotal).toBe("10500.00");expect(t.lines[0].lineTotal).toBe("10500.00");});

});
