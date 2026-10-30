import type { Tenant } from "@fii/database";
import type { InvoiceWithRelations } from "./invoice.js";
import { amountInWords } from "./amount-words.js";

export const referenceTemplates = ["TELECOM_STATEMENT", "SERVICE_TAX", "IT_SERVICES"] as const;
type ReferenceTemplate = typeof referenceTemplates[number];
const money = (v: unknown) => Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
const join = (v: Array<string | null | undefined>) => v.filter(Boolean).join("\n");
const clean = (s: string) => [...s.replace(/\r\n?/g, "\n")].filter(c => c === "\n" || c === "\t" || c.charCodeAt(0) >= 32).join("");

/** Reference-inspired forms; all identity, tax, payment and terms data comes from this tenant/invoice. */
export function renderReferenceInvoice(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, tenant: Tenant, place: string, template: ReferenceTemplate): void {
  const telecom = template === "TELECOM_STATEMENT", service = template === "SERVICE_TAX", it = template === "IT_SERVICES";
  const L = telecom ? 41 : service ? 10 : 25, R = telecom ? 581 : service ? 585 : 570, W = R - L, BOTTOM = telecom ? 824 : service ? 772 : 790;
  const ink = "#171717", muted = "#555555", border = it ? "#AAAAAA" : "#333333";
  let y = 28, page = 1;
  const text = (value: string, x: number, top: number, width: number, size = 9, bold = false, align: "left" | "right" | "center" = "left", color = ink) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color).text(clean(value), x, top, { width, align, lineGap: 1 }); return doc.y;
  };
  const height = (value: string, width: number, size = 9, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size); return doc.heightOfString(clean(value), { width, lineGap: 1 });
  };
  const line = (top: number, x = L, right = R) => doc.moveTo(x, top).lineTo(right, top).lineWidth(0.6).strokeColor(border).stroke();
  const box = (x: number, top: number, width: number, h: number) => doc.rect(x, top, width, h).lineWidth(0.6).strokeColor(border).stroke();
  const vertical = (x: number, top: number, bottom: number) => doc.moveTo(x, top).lineTo(x, bottom).lineWidth(0.6).strokeColor(border).stroke();
  const image = (url: string | null, x: number, top: number, width: number, h: number) => {
    if (!url?.startsWith("data:image/")) return false;
    try { doc.image(Buffer.from(url.split(",")[1], "base64"), x, top, { fit: [width, h] }); return true; } catch { return false; }
  };
  const footer = () => { if (telecom) return; line(800); text("Computer-generated invoice | All amounts in INR", L, 807, W - 60, 7, false, "left", muted); text(`Page ${page}`, R - 60, 807, 60, 7, false, "right", muted); };
  const nextPage = () => { footer(); doc.addPage({ size: "A4", margin: 0 }); page++; text(tenant.name, L, 28, 310, 11, true); text(invoice.invoiceNumber, R - 190, 28, 190, 10, true, "right"); line(49); y = 60; };
  const ensure = (h: number) => { if (y + h > BOTTOM) nextPage(); };
  const title = invoice.chargeGst ? "TAX INVOICE" : "INVOICE - WITHOUT GST";
  const period = invoice.periodStart && invoice.periodEnd ? `${date(invoice.periodStart)} - ${date(invoice.periodEnd)}` : "-";
  const address = join([tenant.addressLine1, tenant.addressLine2, [tenant.city, tenant.pincode].filter(Boolean).join(" - ")]);
  const contact = [tenant.phone, tenant.email].filter(Boolean).join(" | ");
  const c = invoice.customer;
  const bill = join([c.name, c.billingAddress, [c.city, c.stateName, c.pincode].filter(Boolean).join(", "), c.gstin ? `GSTIN: ${c.gstin}` : null, c.phone, c.email]);
  const installation = join([c.name, c.serviceAddress, [c.installationCity, c.installationState, c.installationPincode].filter(Boolean).join(", ")]);
  const bank = join([tenant.bankName ? `Bank: ${tenant.bankName}` : null, tenant.bankAccountNo ? `A/c: ${tenant.bankAccountNo}` : null, tenant.bankBranch ? `Branch: ${tenant.bankBranch}` : null, tenant.bankIfsc ? `IFSC: ${tenant.bankIfsc}` : null, tenant.bankPayableAt ? `Payable at: ${tenant.bankPayableAt}` : null]);
  const terms = invoice.terms || tenant.invoiceTerms || "";
  const fields: Array<[string, string]> = [["Invoice No.", invoice.invoiceNumber], ["Dated", date(invoice.invoiceDate)], ["Customer P.O. No.", invoice.poNumber || "-"], ["Payment Due Date", date(invoice.dueDate)], ["Billing Period", period], ["Status", invoice.status]];
  const labelValue = (label: string, value: string, x: number, top: number, width: number, size = 8.5) => {
    text(label, x, top, width, size); return text(value, x, top + 12, width, size, true);
  };
  const logoHeader = (top: number, h: number, size: number, bordered: boolean) => {
    if (bordered) box(L, top, W, h);
    const hasLogo = image(tenant.logoUrl, L + 3, top + 5, 76, h - 10), x = L + (hasLogo ? 87 : 8);
    const end = text(tenant.name, x, top + 11, R - x - 8, size, true);
    return { x, end };
  };
  if (telecom) {
    y = 14; box(L, y, W, 19); text(title, L, y + 4, W, 11, true, "center"); y += 19;
    logoHeader(y, 72, 18, true); y += 72;
    const top = y, split = L + W / 2, rightW = W / 2, cw = rightW / 2;
    const office = join(["Corporate Office:", address, `State code: ${tenant.stateCode || "-"}`, contact]);
    const h = Math.max(85, height(office, W / 2 - 10, 9, true) + 10);
    box(L, top, W, h); vertical(split, top, top + h); text(office, L + 4, top + 5, W / 2 - 10, 9, true);
    for (let row = 0; row < 3; row++) {
      const fy = top + row * h / 3;
      if (row) line(fy, split, R); vertical(split + cw, fy, fy + h / 3);
      fields.slice(row * 2, row * 2 + 2).forEach(([label, value], col) => labelValue(label, value, split + col * cw + 4, fy + 3, cw - 8, 8));
    }
    y += h;
    const partyH = Math.max(74, height(bill, W / 2 - 10, 8.5) + 20, height(installation, W / 2 - 10, 8) + 34);
    box(L, y, W, partyH); vertical(split, y, y + partyH);
    text("Buyer:", L + 4, y + 4, W / 2 - 10, 8.5); text(bill, L + 4, y + 17, W / 2 - 10, 8.5);
    text("Location / Installation:", split + 5, y + 4, rightW - 10, 8);
    text(installation, split + 5, y + 17, rightW - 10, 8);
    text(`Customer Code: ${c.code}    GSTIN: ${c.gstin || "-"}`, split + 5, y + partyH - 13, rightW - 10, 7.5); y += partyH;
  } else if (service) {
    y = 10; text(invoice.chargeGst ? "Tax Invoice" : "Invoice - Without GST", L, y, W, 12, true, "center"); y += 13;
    const top = y, split = L + W * 0.565, rightW = R - split;
    const hasLogo = image(tenant.logoUrl, L + 4, top + 10, 62, 54), x = L + (hasLogo ? 74 : 6), width = split - x - 5;
    let end = text(tenant.name, x, top + 6, width, 10.5, true);
    end = text(join([address, `State code: ${tenant.stateCode || "-"}`, tenant.gstin ? `GSTIN/UIN: ${tenant.gstin}` : null, contact]), x, end + 3, width, 8.5);
    const colWidths = [rightW * 0.42, rightW * 0.29, rightW * 0.29];
    let fx = split;
    [["Invoice #:", invoice.invoiceNumber], ["Dated:", date(invoice.invoiceDate)], ["Due On:", date(invoice.dueDate)]].forEach(([label, value], i) => { box(fx, top, colWidths[i], 31); labelValue(label, value, fx + 4, top + 4, colWidths[i] - 8, 7.5); fx += colWidths[i]; });
    const buyerH = Math.max(78, height(bill, rightW - 10, 8.5) + 18);
    box(split, top + 31, rightW, buyerH); text("Buyer (Bill to)", split + 5, top + 35, rightW - 10, 8); text(bill, split + 5, top + 47, rightW - 10, 8.5);
    const h = Math.max(end - top + 8, buyerH + 31); box(L, top, W, h); vertical(split, top, top + h); y += h;
    // Keep the installation address in a compact row rather than changing the reference header.
    const installLine = `Installation: ${installation.replace(/\n/g, ", ")}`;
    const ih = height(installLine, W - 10, 8) + 9; box(L, y, W, ih); text(installLine, L + 5, y + 4, W - 10, 8); y += ih;
  } else {
    y = 22;
    const h = logoHeader(y, 47, 12, false); text(address.replace(/\n/g, ", "), h.x, h.end + 3, R - h.x, 8); text(contact, h.x, h.end + 15, R - h.x, 8);
    y += 50; line(y); text(title, L, y + 7, W, 13, true, "center"); y += 26; line(y);
    const top = y, colW = W / 3;
    const legal = join([tenant.gstin ? `GSTIN: ${tenant.gstin}` : null, tenant.pan ? `PAN: ${tenant.pan}` : null, `State Code: ${tenant.stateCode || "-"}`]);
    const meta = `Invoice No: ${invoice.invoiceNumber}\nInvoice Date: ${date(invoice.invoiceDate)}\nDue Date: ${date(invoice.dueDate)}`;
    const center = `BILLING DETAILS\n\nPeriod: ${period}\n\nPO: ${invoice.poNumber || "-"}\n\n${invoice.status}`;
    const mh = Math.max(120, height(legal, colW - 12, 9) + 18, height(meta, colW - 12, 9) + 18, height(center, colW - 12, 8) + 18);
    text(legal, L + 5, top + 10, colW - 12, 9); vertical(L + colW, top, top + mh);
    text(center, L + colW + 6, top + 10, colW - 12, 8, false, "center"); vertical(L + colW * 2, top, top + mh);
    text(meta, L + colW * 2 + 6, top + 10, colW - 12, 9); y += mh; line(y);
    // The reference's identifier strips become real PO/supply fields when no e-invoice registration exists.
    for (const value of [`Purchase Order: ${invoice.poNumber || "-"}`, `Place of Supply: ${place}    |    Billing Period: ${period}`]) {
      const hh = height(value, W - 10, 8) + 9; doc.rect(L, y, W, hh).fill("#F2F2F2"); text(value, L + 5, y + 4, W - 10, 8); y += hh; line(y);
    }
    const topParty = y + 7, split = L + W * 0.51;
    text("BILL TO:", L + 5, topParty, split - L - 10, 8.5, true); const billEnd = text(bill, L + 5, topParty + 16, split - L - 10, 8.5);
    text("Our Bank Account Details:", split, topParty, R - split, 8.5, true); const bankEnd = text(join([tenant.name, bank]), split, topParty + 16, R - split - 5, 8.5);
    const installEnd = text(`Installation: ${installation.replace(/\n/g, ", ")}`, L + 5, billEnd + 5, split - L - 10, 8);
    y = Math.max(installEnd, bankEnd) + 9;
  }

  const widths = it ? [28, 272, 50, 30, 58, 38, W - 476] : [telecom ? 39 : 30, W - (telecom ? 202 : 230), telecom ? 74 : 100, telecom ? 89 : 100];
  const headings = it ? ["S.No.", "Description of Service", "HSN/SAC", "Qty", "Rate (Rs.)", "GST%", "Amount (Rs.)"] : ["S.#", "Description of Services", "HSN/SAC", "Amount"];
  const xs: number[] = []; widths.reduce((x, w, i) => { xs[i] = x; return x + w; }, L);
  const tableHead = () => {
    if (it) doc.rect(L, y, W, 20).fill("#EEEEEE");
    box(L, y, W, 20); xs.slice(1).forEach(x => vertical(x, y, y + 20));
    headings.forEach((v, i) => text(v, xs[i] + 3, y + 6, widths[i] - 6, it ? 7 : 9, true, i === 1 ? "center" : i > 1 ? "right" : "left")); y += 20;
  };
  ensure(60); tableHead();
  let bodyTop = y;
  const extendBody = (bottom: number) => { box(L, bodyTop, W, bottom - bodyTop); xs.slice(1).forEach(x => vertical(x, bodyTop, bottom)); y = bottom; };
  const taxRows: Array<[string, number]> = [];
  if (invoice.chargeGst) {
    if (invoice.isInterState) taxRows.push(["IGST", Number(invoice.igst)]);
    else taxRows.push(["CGST", Number(invoice.cgst)], ["SGST", Number(invoice.sgst)]);
  }
  if (Number(invoice.roundOff)) taxRows.push(["Round off", Number(invoice.roundOff)]);

  invoice.items.forEach((item, i) => {
    const extra = !it && Number(item.quantity) !== 1 ? ` | Qty ${Number(item.quantity)} x ${money(item.unitPrice)}` : "";
    const name = `${item.description}${extra}${Number(item.discount) ? ` | Discount ${money(item.discount)}` : ""}`;
    const rh = Math.max(it ? (invoice.items.length > 4 ? 24 : 28) : 22, height(name, widths[1] - 10, 8.5) + 12);
    if (y + rh > (service ? 730 : BOTTOM - 15)) { extendBody(y); nextPage(); tableHead(); bodyTop = y; }
    if (it) box(L, y, W, rh);
    text(String(i + 1), L + 4, y + 6, widths[0] - 8, 8);
    text(name, xs[1] + 5, y + 6, widths[1] - 10, 8.5);
    const hsn = item.hsnSac && item.hsnSac !== "0" ? item.hsnSac : "-";
    const values = it ? [hsn, String(Number(item.quantity)), money(item.unitPrice), String(Number(item.gstRate)), money(item.taxableValue)] : [hsn, money(item.taxableValue)];
    values.forEach((value, j) => text(value, xs[j + 2] + 3, y + 6, widths[j + 2] - 6, 8, false, "right"));
    y += rh;
  });
  // Preserve the open service area and continuous vertical rules of the supplied forms.
  let taxesInside = false;
  if (service && page === 1) {
    const taxH = taxRows.length * 19;
    const bottom = Math.max(y + taxH + 5, 365);
    if (bottom < BOTTOM) {
      y = bottom - taxH;
      taxRows.forEach(([label, value]) => { text(label, xs[2] - 180, y + 4, 175, 10, false, "right"); text(money(value), R - widths[3] + 4, y + 4, widths[3] - 8, 10, false, "right"); y += 19; });
      extendBody(bottom); taxesInside = true;
    } else extendBody(y);
  } else {
    extendBody(Math.max(y, telecom && page === 1 ? bodyTop + 62 : y));
  }
  const fullRow = (label: string, value: string, bold = false, h = 19) => {
    ensure(h); if (it && bold) doc.rect(L, y, W, h).fill("#F2F2F2"); box(L, y, W, h); vertical(R - (it ? widths[6] : widths[3]), y, y + h);
    text(label, L + 4, y + 5, W - (it ? widths[6] : widths[3]) - 9, 9, bold, it ? "right" : "left");
    text(value, R - (it ? widths[6] : widths[3]) + 3, y + 5, (it ? widths[6] : widths[3]) - 6, 9, bold, "right"); y += h;
  };
  if (!taxesInside) {
    if (it) fullRow("Total Amount Before Tax", money(invoice.taxableValue), true);
    taxRows.forEach(([label, value]) => fullRow(label, money(value)));
  }
  const balance = Math.max(0, Number(invoice.grandTotal) - Number(invoice.amountPaid) - Number(invoice.creditedAmount));
  if (telecom && invoice.chargeGst) fullRow("Total GST", money(Number(invoice.cgst) + Number(invoice.sgst) + Number(invoice.igst)));
  fullRow(it ? "Grand Total" : "Total", money(invoice.grandTotal), true, 21);
  if (invoice.status !== "CANCELLED") {
    if (Number(invoice.amountPaid)) fullRow("Amount paid", money(invoice.amountPaid));
    if (Number(invoice.creditedAmount)) fullRow("Credit adjustments", money(invoice.creditedAmount));
  }
  if (invoice.status !== "CANCELLED" && (Number(invoice.amountPaid) || Number(invoice.creditedAmount))) fullRow("Balance due", money(balance), true);
  const words = `INR ${amountInWords(Number(invoice.grandTotal))} ONLY`;
  const wh = Math.max(28, height(words, W - 10, 8.5, true) + 18); ensure(wh); box(L, y, W, wh);
  text(service ? "Amount Chargeable (in words)" : "Amount in words:", L + 5, y + 4, W - 10, 8.5);
  text(words, L + 5, y + 16, W - 10, 8.5, !it); y += wh;

  if (service && invoice.chargeGst) {
    const groups = new Map<string, { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
    for (const item of invoice.items) {
      const hsn = item.hsnSac && item.hsnSac !== "0" ? item.hsnSac : "-", key = `${hsn}:${item.gstRate}`;
      const row = groups.get(key) ?? { hsn, rate: Number(item.gstRate), taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      row.taxable += Number(item.taxableValue); row.cgst += Number(item.cgst); row.sgst += Number(item.sgst); row.igst += Number(item.igst); groups.set(key, row);
    }
    const cols = invoice.isInterState ? [100, 110, 70, 120, W - 400] : [100, 110, 45, 85, 45, 85, W - 470];
    const cx: number[] = []; cols.reduce((x, w, i) => { cx[i] = x; return x + w; }, L);
    const head = () => {
      const hh = 30; box(L, y, W, hh);
      text("HSN/SAC", cx[0] + 3, y + 10, cols[0] - 6, 8, false, "center");
      text("Taxable Value", cx[1] + 3, y + 10, cols[1] - 6, 8, false, "center");
      vertical(cx[1], y, y + hh); vertical(cx[2], y, y + hh);
      if (invoice.isInterState) {
        text("IGST", cx[2], y + 3, cols[2] + cols[3], 9, false, "center");
        line(y + 15, cx[2], cx[4]); vertical(cx[3], y + 15, y + hh); vertical(cx[4], y, y + hh);
        text("Rate", cx[2], y + 18, cols[2], 8, false, "center"); text("Amount", cx[3], y + 18, cols[3], 8, false, "center");
        text("Total Tax Amount", cx[4] + 3, y + 10, cols[4] - 6, 8, false, "center");
      } else {
        for (const [i, label] of [[2, "CGST"], [4, "SGST"]] as const) {
          text(label, cx[i], y + 3, cols[i] + cols[i + 1], 9, false, "center");
          line(y + 15, cx[i], cx[i] + cols[i] + cols[i + 1]); vertical(cx[i + 1], y + 15, y + hh); vertical(cx[i + 2], y, y + hh);
          text("Rate", cx[i], y + 18, cols[i], 8, false, "center"); text("Amount", cx[i + 1], y + 18, cols[i + 1], 8, false, "center");
        }
        text("Total Tax Amount", cx[6] + 3, y + 10, cols[6] - 6, 8, false, "center");
      }
      y += hh;
    };
    ensure(45); head();
    for (const row of groups.values()) {
      if (y + 18 > BOTTOM) { nextPage(); head(); }
      const values = [row.hsn, money(row.taxable), ...(invoice.isInterState ? [`${row.rate}%`, money(row.igst)] : [`${row.rate / 2}%`, money(row.cgst), `${row.rate / 2}%`, money(row.sgst)]), money(row.cgst + row.sgst + row.igst)];
      box(L, y, W, 18); values.forEach((v, i) => { if (i) vertical(cx[i], y, y + 18); text(v, cx[i] + 3, y + 4, cols[i] - 6, 8, false, "right"); }); y += 18;
    }
    ensure(18); box(L, y, W, 18);
    const taxTotal = Number(invoice.cgst) + Number(invoice.sgst) + Number(invoice.igst);
    const totalValues = ["Total", money(invoice.taxableValue), ...(invoice.isInterState ? ["", money(invoice.igst)] : ["", money(invoice.cgst), "", money(invoice.sgst)]), money(taxTotal)];
    totalValues.forEach((v, i) => { if (i) vertical(cx[i], y, y + 18); text(v, cx[i] + 3, y + 4, cols[i] - 6, 8, true, "right"); }); y += 18;
    const taxWords = `Tax Amount (in words): INR ${amountInWords(taxTotal)}`;
    const th = height(taxWords, W - 10, 8) + 8; ensure(th); box(L, y, W, th); text(taxWords, L + 5, y + 4, W - 10, 8); y += th;
  }
  if (service) { const pan = `Company's PAN: ${tenant.pan || "-"}`; ensure(18); box(L, y, W, 18); text(pan, L + 5, y + 4, W - 10, 9); y += 18; }

  const sign = (top: number, h: number, split: number, customer: string) => {
    box(L, top, W, h); vertical(split, top, top + h); text(customer, L + 5, top + 5, split - L - 10, 8);
    text(`For ${tenant.name}`, split + 5, top + 5, R - split - 10, 8.5, true, "right"); image(tenant.signatureUrl, R - 95, top + 19, 85, Math.max(15, h - 35));
    text("Authorised Signatory", split + 5, top + h - 12, R - split - 10, 8, false, "right");
  };
  if (telecom) {
    fullRow("Remarks:", "", false, 18);
    const split = L + W * 0.52;
    const legal = join([tenant.gstin ? `Company's GST No: ${tenant.gstin}` : null, tenant.pan ? `Company's PAN No: ${tenant.pan}` : null]);
    const bh = Math.max(54, height(bank, R - split - 10, 8.5) + 20, height(legal, split - L - 10, 8.5) + 12); ensure(bh);
    box(L, y, W, bh); vertical(split, y, y + bh); text(legal, L + 5, y + 5, split - L - 10, 8.5); text("Company's Bank Details:", split + 5, y + 5, R - split - 10, 8.5); text(bank || "-", split + 5, y + 18, R - split - 10, 8.5); y += bh;
    ensure(150); const declarationH = Math.min(104, Math.max(63, BOTTOM - y - Math.max(45, height(terms, W - 10, 8) + 20) - 53));
    box(L, y, W, declarationH); vertical(split, y, y + declarationH);
    text("Declaration:", L + 5, y + 6, split - L - 10, 9, true); text("Invoice details and amounts are shown above. Please quote the invoice number with your payment.", L + 5, y + 20, split - L - 10, 8.5);
    text(`For ${tenant.name}`, split + 5, y + 6, R - split - 10, 8.5, true, "right"); image(tenant.signatureUrl, R - 95, y + 25, 85, declarationH - 43); text("Authorised Signatory", split + 5, y + declarationH - 13, R - split - 10, 8, false, "right"); y += declarationH;
    const th = Math.max(height(terms, W - 10, 8) + 24, BOTTOM - y - 53); ensure(th + 53); box(L, y, W, th); text("Terms & Conditions:", L + 5, y + 5, W - 10, 9, true); if (terms) text(terms, L + 5, y + 20, W - 10, 8); y += th;
    box(L, y, W, 53); vertical(split, y, y + 53); text("Prepared by", L, y + 12, split - L, 8.5, true, "center"); text("Authorised by", split, y + 12, R - split, 8.5, true, "center");
  } else if (service) {
    const split = L + W * 0.52;
    const dh = Math.max(105, height(terms, split - L - 12, 8) + 43, height(bank, R - split - 12, 8.5) + 23, 730 - y);
    ensure(dh + 39); box(L, y, W, dh);
    text("Declaration", L + 5, y + 23, split - L - 10, 10, true); if (terms) text(terms, L + 5, y + 47, split - L - 12, 8);
    text("Company's Bank Details", split + 5, y + dh - height(bank, R - split - 12, 8.5) - 18, R - split - 12, 9); text(bank || "-", split + 5, y + dh - height(bank, R - split - 12, 8.5) - 5, R - split - 12, 8.5); y += dh;
    sign(y, 39, split, "Customer's Seal and Signature");
  } else {
    y += 9; line(y); y += 10;
    const th = Math.max(invoice.items.length > 4 ? 42 : 84, height(terms, W * 0.67, 8.5) + 26); ensure(th + 55);
    text("Terms & Conditions:", L + 5, y, W * 0.67, 9, true); if (terms) text(terms, L + 8, y + 17, W * 0.67 - 8, 8.5);
    if (invoice.status === "PAID") { doc.save().translate(R - 139, y + 37).rotate(-13).roundedRect(0, 0, 125, 34, 4).lineWidth(2).strokeColor("#3D925D").stroke(); text("PAID", 7, 5, 111, 22, true, "center", "#3D925D"); doc.restore(); }
    y += th; text(`For ${tenant.name}`, R - 250, y, 245, 8, true, "right"); image(tenant.signatureUrl, R - 100, y + 15, 90, 25); text("Authorised Signatory", R - 170, y + 43, 165, 7.5, false, "right");
  }
  footer();
}
