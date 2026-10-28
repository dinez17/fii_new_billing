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

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(gstin: string, expectedStateCode?: string): boolean {
  if (!GSTIN_REGEX.test(gstin)) return false;
  if (expectedStateCode && gstin.slice(0, 2) !== expectedStateCode) return false;
  return true;
}
