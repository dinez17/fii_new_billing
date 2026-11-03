import { Decimal } from "decimal.js";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export const D = (v: Decimal.Value) => new Decimal(v);
const r2 = (v: Decimal) => v.toDecimalPlaces(2);

export interface GstLineInput {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;   // GST-exclusive
  discount?: Decimal.Value;   // absolute amount on the line
  gstRate: Decimal.Value;     // e.g. 18
}

export interface GstLine {
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
}

export interface GstTotals {
  lines: GstLine[];
  subTotal: string;
  discountTotal: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  grandTotal: string;
}

/**
 * Line-level GST computation. Intra-state → CGST+SGST (rate/2 each);
 * inter-state → IGST. Rounds each line to 2dp, sums, then rounds grand
 * total to the nearest rupee with `roundOff` absorbing the paise.
 */
export function computeGst(items: GstLineInput[], isInterState: boolean): GstTotals {
  const lines: GstLine[] = [];
  let subTotal = D(0), discountTotal = D(0), taxable = D(0);
  let cgst = D(0), sgst = D(0), igst = D(0);

  for (const it of items) {
    const gross = r2(D(it.quantity).mul(it.unitPrice));
    const disc = r2(D(it.discount ?? 0));
    if (disc.gt(gross)) throw new Error("discount exceeds line amount");
    const base = gross.sub(disc);
    const rate = D(it.gstRate);

    let lCgst = D(0), lSgst = D(0), lIgst = D(0);
    if (isInterState) {
      lIgst = r2(base.mul(rate).div(100));
    } else {
      lCgst = r2(base.mul(rate).div(200));
      lSgst = lCgst;
    }
    const lineTotal = base.add(lCgst).add(lSgst).add(lIgst);

    subTotal = subTotal.add(gross);
    discountTotal = discountTotal.add(disc);
    taxable = taxable.add(base);
    cgst = cgst.add(lCgst); sgst = sgst.add(lSgst); igst = igst.add(lIgst);

    lines.push({
      taxableValue: base.toFixed(2),
      cgst: lCgst.toFixed(2), sgst: lSgst.toFixed(2), igst: lIgst.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    });
  }

  const exact = taxable.add(cgst).add(sgst).add(igst);
  const rounded = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const roundOff = rounded.sub(exact);

  return {
    lines,
    subTotal: subTotal.toFixed(2),
    discountTotal: discountTotal.toFixed(2),
    taxableValue: taxable.toFixed(2),
    cgst: cgst.toFixed(2), sgst: sgst.toFixed(2), igst: igst.toFixed(2),
    roundOff: roundOff.toFixed(2),
    grandTotal: rounded.toFixed(2),
  };
}

/** Supplier invoices may round each invoice-level GST component to whole rupees. */
export function computePurchaseGst(items:GstLineInput[],isInterState:boolean,taxRounding:"PAISE"|"WHOLE_RUPEE"="PAISE",pricesIncludeGst=false):GstTotals {
 const totals=computeGst(items,isInterState);
 if(pricesIncludeGst){
  let taxable=D(0),discount=D(0),cgst=D(0),sgst=D(0),igst=D(0);
  totals.lines=items.map(item=>{
   const gross=r2(D(item.quantity).mul(item.unitPrice)),disc=r2(D(item.discount??0));
   if(disc.gt(gross))throw new Error("discount exceeds line amount");
   const factor=D(1).add(D(item.gstRate).div(100)),net=gross.sub(disc),base=r2(net.div(factor)),tax=net.sub(base);
   const c=isInterState?D(0):r2(tax.div(2)),s=isInterState?D(0):tax.sub(c),i=isInterState?tax:D(0);
   taxable=taxable.add(base);discount=discount.add(r2(disc.div(factor)));cgst=cgst.add(c);sgst=sgst.add(s);igst=igst.add(i);
   return {taxableValue:base.toFixed(2),cgst:c.toFixed(2),sgst:s.toFixed(2),igst:i.toFixed(2),lineTotal:net.toFixed(2)};
  });
  totals.taxableValue=taxable.toFixed(2);totals.discountTotal=discount.toFixed(2);totals.subTotal=taxable.add(discount).toFixed(2);totals.cgst=cgst.toFixed(2);totals.sgst=sgst.toFixed(2);totals.igst=igst.toFixed(2);
  const exact=taxable.add(cgst).add(sgst).add(igst),grand=exact.toDecimalPlaces(0);totals.roundOff=grand.sub(exact).toFixed(2);totals.grandTotal=grand.toFixed(2);
 }
 if(taxRounding==="PAISE")return totals;
 for(const key of ["cgst","sgst","igst"] as const){
  const rounded=D(totals[key]).toDecimalPlaces(0),delta=rounded.sub(totals[key]);
  if(!delta.isZero()){
   let left=delta;
   for(const line of [...totals.lines].sort((a,b)=>D(b[key]).comparedTo(a[key]))){
    if(left.isZero())break;
    const adjustment=left.isPositive()?left:Decimal.max(left,D(line[key]).neg());
    line[key]=D(line[key]).add(adjustment).toFixed(2);
    if(pricesIncludeGst){line.taxableValue=D(line.taxableValue).sub(adjustment).toFixed(2);totals.taxableValue=D(totals.taxableValue).sub(adjustment).toFixed(2);totals.subTotal=D(totals.subTotal).sub(adjustment).toFixed(2);}else line.lineTotal=D(line.lineTotal).add(adjustment).toFixed(2);
    left=left.sub(adjustment);
   }
   if(!left.isZero())throw new Error("Cannot allocate supplier GST rounding");
  }
  totals[key]=rounded.toFixed(2);
 }
 const exact=D(totals.taxableValue).add(totals.cgst).add(totals.sgst).add(totals.igst),grand=exact.toDecimalPlaces(0);
 totals.roundOff=grand.sub(exact).toFixed(2);totals.grandTotal=grand.toFixed(2);return totals;
}

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(gstin: string, expectedStateCode?: string): boolean {
  if (!GSTIN_REGEX.test(gstin)) return false;
  if (expectedStateCode && gstin.slice(0, 2) !== expectedStateCode) return false;
  return true;
}
