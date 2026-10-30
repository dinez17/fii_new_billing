import type { Tenant } from "@fii/database";
import type { InvoiceWithRelations } from "./invoice.js";
import { referenceTemplates, renderReferenceInvoice } from "./invoice-reference-layouts.js";
import { amountInWords } from "./amount-words.js";

const L = 36, R = 559, W = R - L, BOTTOM = 780;
const THEMES = {
  COMMERCIAL: { ink: "#18334D", muted: "#5E6E7D", rule: "#D6DFE7", soft: "#F0F5F8", accent: "#117C78" },
  TALLY: { ink: "#111111", muted: "#444444", rule: "#444444", soft: "#FFFFFF", accent: "#111111" },
  CLASSIC: { ink: "#302923", muted: "#665D53", rule: "#C5B9A8", soft: "#F7F4EE", accent: "#8D6939" },
  MODERN: { ink: "#18334D", muted: "#566B7F", rule: "#CEDCE9", soft: "#EAF3FC", accent: "#236FC1" },
  MINIMAL: { ink: "#222222", muted: "#666666", rule: "#DDDDDD", soft: "#FAFAFA", accent: "#222222" },
  COMPACT: { ink: "#263B32", muted: "#55635C", rule: "#CDD8D1", soft: "#EDF3EF", accent: "#32684B" },
};
const money = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: Date) => `${String(value.getUTCDate()).padStart(2, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${value.getUTCFullYear()}`;
const cleanText = (value: string) => [...value.replace(/\r\n?/g, "\n")]
  .filter((char) => char === "\n" || char === "\t" || (char.charCodeAt(0) >= 32 && char !== "\u200B" && char !== "\uFEFF"))
  .join("");
const lines = (values: Array<string | null | undefined>) => values.filter((value) => value?.trim()).join("\n");

function description(value: string, subscription: boolean): string {
  if (!subscription || value.includes("\n")) return value;
  const parts = /^(.*) \((\d{1,2} .+?\d{4} [–-] \d{1,2} .+?\d{4})\)$/.exec(value);
  if (!parts) return value;
  const split = parts[1].lastIndexOf(" — ");
  return split < 0 ? `${parts[1]}\n${parts[2]}` : `${parts[1].slice(0, split)}\n${parts[1].slice(split + 3)} · ${parts[2]}`;
}

/** Commercial invoice layout: complete addresses, flowing rows and paginated summaries. */
export function renderCommercialInvoice(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, tenant: Tenant, placeOfSupply: string, template = "COMMERCIAL"): void {
  if (referenceTemplates.includes(template as typeof referenceTemplates[number])) {
    renderReferenceInvoice(doc, invoice, tenant, placeOfSupply, template as typeof referenceTemplates[number]);
    return;
  }
  const kind = Object.hasOwn(THEMES, template) ? template as keyof typeof THEMES : "COMMERCIAL";
  const { ink: INK, muted: MUTED, rule: RULE, soft: SOFT, accent: ACCENT } = THEMES[kind];
  const grid = kind === "TALLY", minimal = kind === "MINIMAL", compact = kind === "COMPACT", classic = kind === "CLASSIC", modern = kind === "MODERN";
  const regularFont = classic ? "Times-Roman" : "Helvetica";
  const boldFont = classic ? "Times-Bold" : "Helvetica-Bold";
  let y = 36, page = 1;
  const rule = (top: number, left = L, right = R) => doc.moveTo(left, top).lineTo(right, top).lineWidth(0.6).strokeColor(RULE).stroke();
  const text = (value: string, x: number, top: number, width: number, size = 9, bold = false, color = INK, align: "left" | "right" | "center" = "left") => {
    doc.font(bold ? boldFont : regularFont).fontSize(size).fillColor(color).text(cleanText(value), x, top, { width, align, lineGap: 1 });
    return doc.y;
  };
  const height = (value: string, width: number, size = 9, bold = false) => {
    doc.font(bold ? boldFont : regularFont).fontSize(size);
    return doc.heightOfString(cleanText(value), { width, lineGap: 1 });
  };
  const footer = () => {
    rule(799);
    text("Computer-generated invoice · All amounts in INR", L, 808, 400, 7.5, false, MUTED);
    text(`Page ${page}`, R - 60, 808, 60, 7.5, false, MUTED, "right");
  };
  const nextPage = () => {
    footer(); doc.addPage({ size: "A4", margin: 0 }); page++;
    text(tenant.name, L, 35, 310, 12, true);
    text(invoice.invoiceNumber, R - 190, 35, 190, 10, true, INK, "right");
    text("INVOICE CONTINUED", L, 55, W, 8, false, MUTED); rule(74); y = 88;
  };
  const ensure = (space: number) => { if (y + space > BOTTOM) nextPage(); };

  const customer = invoice.customer;
  const bill = lines([customer.billingAddress, [customer.city, customer.stateName, customer.pincode].filter(Boolean).join(", ")]);
  const installation = lines([customer.serviceAddress, [customer.installationCity, customer.installationState, customer.installationPincode].filter(Boolean).join(", ")]);
  const billingBody = lines([customer.name, bill || "Address not provided", customer.gstin ? `GSTIN: ${customer.gstin}` : null, customer.phone ? `Phone: ${customer.phone}` : null, customer.email]);
  const installBody = lines([customer.name, installation || "Address not provided"]);

  const title = invoice.chargeGst ? "TAX INVOICE" : "INVOICE - WITHOUT GST";
  const periodLabel = invoice.periodStart && invoice.periodEnd ? `${date(invoice.periodStart)} - ${date(invoice.periodEnd)}` : "-";
  const status = invoice.status.replace(/_/g, " ");
  const box = (x: number, top: number, width: number, h: number, color = RULE) => doc.rect(x, top, width, h).lineWidth(0.6).strokeColor(color).stroke();
  const image = (url: string | null, x: number, top: number, width: number, h: number) => {
    if (!url?.startsWith("data:image/")) return false;
    try { doc.image(Buffer.from(url.split(",")[1], "base64"), x, top, { fit: [width, h] }); return true; } catch { return false; }
  };
  const company = (x: number, top: number, width: number, centered = false, size = 13, inlineLogo = false) => {
    let start = top;
    if (centered || inlineLogo) image(tenant.logoUrl, x + width - 36, start, 36, 32);
    else if (!centered && image(tenant.logoUrl, x, start, 38, 35)) start += 40;
    const align = centered ? "center" as const : "left" as const;
    let end = text(tenant.name, x, start, inlineLogo ? width - 44 : width, size, true, INK, align);
    const address = lines([tenant.addressLine1, tenant.addressLine2, [tenant.city, tenant.pincode].filter(Boolean).join(" - ")]);
    if (address) end = text(centered ? address.replace(/\n/g, ", ") : address, x, end + 3, width, 8.5, false, MUTED, align);
    const contact = [tenant.phone, tenant.email].filter(Boolean).join(" | ");
    if (contact) end = text(contact, x, end + 3, width, 8, false, MUTED, align);
    if (tenant.gstin) end = text(`GSTIN: ${tenant.gstin}`, x, end + 3, width, 8.5, true, INK, align);
    return end;
  };
  const addressBlock = (label: string, body: string, x: number, top: number, width: number, size = 9) => {
    text(label, x, top, width, 7.5, true, MUTED);
    return text(body, x, top + 14, width, size);
  };
  const fields: Array<[string, string]> = [["Invoice no.", invoice.invoiceNumber], ["Invoice date", date(invoice.invoiceDate)], ["Due date", date(invoice.dueDate)], ["PO number", invoice.poNumber || "-"], ["Billing period", periodLabel], ["Place of supply", placeOfSupply]];
  if (kind === "COMMERCIAL") {
  const headerAddress = lines([tenant.addressLine1, tenant.addressLine2, [tenant.city, tenant.pincode].filter(Boolean).join(" - ")]);
  const headerContact = [tenant.phone, tenant.email].filter(Boolean).join("  |  ");
  const logoOffset = tenant.logoUrl?.startsWith("data:image/") ? 58 : 0;
  const companyHeight = height(tenant.name, 330 - logoOffset, 14, true)
    + (headerAddress ? 3 + height(headerAddress, 320 - logoOffset, 8.5) : 0)
    + (headerContact ? 3 + height(headerContact, 320 - logoOffset, 8) : 0)
    + (tenant.gstin ? 3 + height(`GSTIN: ${tenant.gstin}`, 320 - logoOffset, 8.5, true) : 0);
  const metaHeight = height(invoice.chargeGst ? "TAX INVOICE" : "INVOICE", 180, 16, true)
    + (!invoice.chargeGst ? 3 + height("WITHOUT GST", 180, 8, true) : 0)
    + 5 + height(invoice.invoiceNumber, 180, 11, true)
    + 4 + height(`Invoice date: ${date(invoice.invoiceDate)}\nDue date: ${date(invoice.dueDate)}`, 180, 8.5)
    + 4 + height(invoice.status.replace(/_/g, " "), 180, 8, true);
  const modernBottom = 36 + Math.max(companyHeight, metaHeight) + 10;
  if (modern) doc.rect(L - 12, 25, W + 24, modernBottom - 25).fill(INK);
  else doc.rect(L, 25, W, classic ? 1 : 2).fill(ACCENT);
  const headerInk = modern ? "#FFFFFF" : INK;
  const headerMuted = modern ? "#DAE7F2" : MUTED;
  let companyX = L;
  if (tenant.logoUrl?.startsWith("data:image/")) {
    try { doc.image(Buffer.from(tenant.logoUrl.split(",")[1], "base64"), L, y, { fit: [48, 48] }); companyX += 58; } catch { /* Keep text when logo cannot be decoded. */ }
  }
  let companyY = text(tenant.name, companyX, y, 330 - (companyX - L), 14, true, headerInk);
  const companyAddress = lines([tenant.addressLine1, tenant.addressLine2, [tenant.city, tenant.pincode].filter(Boolean).join(" - ")]);
  if (companyAddress) companyY = text(companyAddress, companyX, companyY + 3, 320 - (companyX - L), 8.5, false, headerMuted);
  const contact = [tenant.phone, tenant.email].filter(Boolean).join("  |  ");
  if (contact) companyY = text(contact, companyX, companyY + 3, 320 - (companyX - L), 8, false, headerMuted);
  if (tenant.gstin) companyY = text(`GSTIN: ${tenant.gstin}`, companyX, companyY + 3, 320 - (companyX - L), 8.5, true, headerInk);

  const metaX = R - 180;
  let metaY = text(invoice.chargeGst ? "TAX INVOICE" : "INVOICE", metaX, y, 180, 16, true, headerInk, "right");
  if (!invoice.chargeGst) metaY = text("WITHOUT GST", metaX, metaY + 3, 180, 8, true, headerMuted, "right");
  metaY = text(invoice.invoiceNumber, metaX, metaY + 5, 180, 11, true, headerInk, "right");
  metaY = text(`Invoice date: ${date(invoice.invoiceDate)}\nDue date: ${date(invoice.dueDate)}`, metaX, metaY + 4, 180, 8.5, false, headerMuted, "right");
  metaY = text(invoice.status.replace(/_/g, " "), metaX, metaY + 4, 180, 8, true, invoice.status === "CANCELLED" ? "#B42318" : (modern ? "#B5EEDC" : ACCENT), "right");
  y = Math.max(companyY, metaY, modern ? modernBottom : compact ? 80 : 90) + 9; rule(y); y += compact ? 6 : 10;

  const cardW = (W - 14) / 2, bodyW = cardW - 22;
  const cardH = Math.max(height(billingBody, bodyW), height(installBody, bodyW)) + (compact ? 25 : 29);
  for (const [x, title, body] of [[L, "BILL TO", billingBody], [L + cardW + 14, "INSTALLATION ADDRESS", installBody]] as const) {
    if (minimal) rule(y, x, x + cardW);
    else doc.roundedRect(x, y, cardW, cardH, grid || classic || compact ? 0 : 5).lineWidth(grid ? 0.8 : 0.6).strokeColor(RULE).stroke();
    text(title, x + 11, y + 10, bodyW, 8, true, ACCENT);
    text(body, x + 11, y + (compact ? 22 : 25), bodyW, 9);
  }
  y += cardH + 10;
  const period = invoice.periodStart && invoice.periodEnd ? `${date(invoice.periodStart)} – ${date(invoice.periodEnd)}` : "—";
  const strip = [["PO NUMBER", invoice.poNumber || "—"], ["BILLING PERIOD", period], ["PLACE OF SUPPLY", placeOfSupply]];
  const stripW = W / 3;
  const stripH = Math.max(...strip.map(([, value]) => height(value, stripW - 20, 8.5))) + 29;
  if (grid) doc.rect(L, y, W, stripH).lineWidth(0.8).strokeColor(RULE).stroke();
  else if (minimal) rule(y);
  else doc.roundedRect(L, y, W, stripH, classic || compact ? 0 : 4).fill(SOFT);
  strip.forEach(([label, value], index) => {
    text(label, L + index * stripW + 10, y + 8, stripW - 20, 7, true, MUTED);
    text(value, L + index * stripW + 10, y + 20, stripW - 20, 8.5);
  });
  y += stripH + 10;


  } else if (grid) {
    // Tally: a continuous accounting form with a company panel and voucher grid.
    text(title, L, 28, W, 13, true, INK, "center");
    y = 52;
    const top = y, split = L + 300;
    const companyEnd = company(L + 9, top + 9, 280, false, 12);
    const voucherFields = fields.slice(0, 4);
    const fieldHeights = voucherFields.map(([, value]) => Math.max(28, height(value, 195, 9, true) + 18));
    const headerH = Math.max(companyEnd - top + 10, fieldHeights.reduce((sum, h) => sum + h, 0));
    box(L, top, W, headerH); doc.moveTo(split, top).lineTo(split, top + headerH).strokeColor(RULE).stroke();
    let fy = top;
    voucherFields.forEach(([label, value], i) => {
      if (i) rule(fy, split, R);
      text(label, split + 8, fy + 4, 195, 7, false, MUTED);
      text(value, split + 8, fy + 15, 195, 9, true);
      fy += fieldHeights[i];
    });
    y = top + headerH;
    const h = Math.max(height(billingBody, 245), height(installBody, 245)) + 32;
    box(L, y, W, h); doc.moveTo(L + W / 2, y).lineTo(L + W / 2, y + h).stroke();
    addressBlock("BUYER (BILL TO)", billingBody, L + 8, y + 8, 245);
    addressBlock("CONSIGNEE (INSTALLATION)", installBody, L + W / 2 + 8, y + 8, 245);
    y += h;
    y = text(`Period: ${periodLabel}    |    Supply: ${placeOfSupply}    |    ${status}`, L + 8, y + 5, W - 16, 8, true) + 8;
  } else if (classic) {
    // Classic: centered letterhead, an invoice ribbon, and unboxed recipient columns.
    y = company(L + 40, 29, W - 80, true, 18) + 10;
    rule(y); rule(y + 3); y += 13;
    text(title, L, y, 190, 14, true);
    text(invoice.invoiceNumber, L + 195, y + 2, W - 195, 12, true, INK, "right"); y += 25;
    text(`Issued ${date(invoice.invoiceDate)}   |   Due ${date(invoice.dueDate)}   |   ${status}`, L, y, W, 9, false, MUTED); y += 24;
    const endA = addressBlock("BILLED TO", billingBody, L, y, 278);
    const endB = addressBlock("SERVICE / INSTALLATION AT", installBody, L + 310, y, W - 310);
    y = Math.max(endA, endB) + 13; rule(y);
    y = text(`PO: ${invoice.poNumber || "-"}     Period: ${periodLabel}     Supply: ${placeOfSupply}`, L, y + 8, W, 8.5) + 14;
  } else if (modern) {
    // Modern: a company sidebar beside stacked destination panels, not a banner.
    doc.rect(0, 0, 13, 842).fill(ACCENT);
    text("INVOICE", L, 28, 240, 28, true);
    text(invoice.invoiceNumber, L + 260, 33, W - 260, 12, true, INK, "right");
    text(invoice.chargeGst ? "GST / TAX INVOICE" : "WITHOUT GST", L, 62, 230, 8, true, ACCENT);
    text(status, R - 180, 62, 180, 8, true, ACCENT, "right");
    y = 85;
    const sideW = 170, rightX = L + 191, rightW = W - 191;
    const aH = height(billingBody, rightW - 20, 8.5) + 28;
    const bH = height(installBody, rightW - 20, 8.5) + 28;
    const companyTop = y;
    const endCompany = company(L + 10, y + 10, sideW - 20, false, 12);
    const panelH = Math.max(aH + bH + 8, endCompany - y + 14);
    // Draw a thin sidebar frame to keep branding readable on any logo background.
    box(L, companyTop, sideW, panelH, ACCENT);
    doc.rect(rightX, y, rightW, aH).fill(SOFT);
    addressBlock("BILL TO", billingBody, rightX + 10, y + 8, rightW - 20, 8.5);
    doc.rect(rightX, y + aH + 8, rightW, bH).fill("#F6F8FB");
    addressBlock("INSTALLATION ADDRESS", installBody, rightX + 10, y + aH + 16, rightW - 20, 8.5);
    y += panelH + 12;
    const meta = `ISSUED  ${date(invoice.invoiceDate)}     DUE  ${date(invoice.dueDate)}     PO  ${invoice.poNumber || "-"}`;
    y = text(meta, L, y, W, 8, true) + 5;
    y = text(`Period: ${periodLabel}    |    Place of supply: ${placeOfSupply}`, L, y, W, 8, false, MUTED) + 13;
  } else if (minimal) {
    // Minimal: large editorial title and a right-hand company column.
    text("Invoice.", L, 30, 250, 34, true);
    text(invoice.invoiceNumber, L, 76, 260, 12, true);
    text(invoice.chargeGst ? "GST INVOICE" : "WITHOUT GST", L, 94, 260, 8, false, MUTED);
    const endCompany = company(L + 300, 32, W - 300, false, 11, true);
    y = Math.max(110, endCompany + 6); rule(y); y += 14;
    const rightX = L + 348, rightW = W - 348;
    let metaY = y;
    for (const [label, value] of fields.slice(1)) {
      text(label.toUpperCase(), rightX, metaY, rightW, 7, true, MUTED);
      metaY = text(value, rightX, metaY + 13, rightW, 9) + 5;
    }
    const billEnd = addressBlock("BILL TO", billingBody, L, y, 310);
    const installEnd = addressBlock("INSTALLATION ADDRESS", installBody, L, billEnd + 10, 310);
    y = Math.max(installEnd, metaY) + 12;
    text(status, L, y, W, 8, true); y += 21;
  } else {
    // Compact Ledger: horizontal voucher, inline party records and tight numeric rows.
    const hasLogo = image(tenant.logoUrl, L, 28, 29, 29);
    const cx = L + (hasLogo ? 37 : 0);
    let end = text(tenant.name, cx, 28, W - 190 - (cx - L), 12, true);
    text(title, R - 180, 28, 180, 10, true, INK, "right");
    end = text(lines([[tenant.addressLine1, tenant.addressLine2, tenant.city, tenant.pincode].filter(Boolean).join(", "), [tenant.phone, tenant.email, tenant.gstin ? `GSTIN ${tenant.gstin}` : ""].filter(Boolean).join(" | ")]), cx, end + 3, W - (cx - L), 8) + 8;
    y = end; rule(y);
    y = text(`${invoice.invoiceNumber}   |   Date ${date(invoice.invoiceDate)}   |   Due ${date(invoice.dueDate)}   |   ${status}`, L, y + 6, W, 9, true) + 9;
    const partyRow = (label: string, body: string) => {
      const h = Math.max(27, height(body.replace(/\n/g, ", "), W - 112, 8.5) + 12);
      doc.rect(L, y, 98, h).fill(SOFT); box(L, y, W, h);
      text(label, L + 6, y + 7, 86, 7.5, true);
      text(body.replace(/\n/g, ", "), L + 106, y + 6, W - 112, 8.5); y += h;
    };
    partyRow("CUSTOMER", billingBody); partyRow("INSTALLATION", installBody);
    y = text(`PO: ${invoice.poNumber || "-"}   |   Period: ${periodLabel}   |   Supply: ${placeOfSupply}`, L, y + 6, W, 8) + 10;
  }

  const showHsnColumn = grid || compact;
  const widths = showHsnColumn
    ? invoice.chargeGst ? [20, 171, 51, 32, 63, 38, 60, 88] : [20, 237, 51, 40, 80, 95]
    : invoice.chargeGst ? [22, 202, 35, 65, 43, 66, 90] : [22, 275, 45, 80, 101];
  const headings = showHsnColumn ? (invoice.chargeGst ? ["#", "PARTICULARS", "HSN/SAC", "QTY", "RATE", "GST %", "GST AMT", "AMOUNT"] : ["#", "PARTICULARS", "HSN/SAC", "QTY", "RATE", "AMOUNT"]) : invoice.chargeGst ? ["#", "DESCRIPTION", "QTY", "RATE", "GST %", "GST AMT", "AMOUNT"] : ["#", "DESCRIPTION", "QTY", "RATE", "AMOUNT"];
  const xs: number[] = []; widths.reduce((x, width, index) => { xs[index] = x; return x + width; }, L);
  const tableHead = () => {
    doc.rect(L, y, W, 23).fill(grid || minimal || classic ? "#FFFFFF" : INK);
    if (grid || minimal || classic) { rule(y); rule(y + 23); }
    if (grid) xs.forEach((x, i) => { doc.moveTo(x, y).lineTo(x, y + 23).lineWidth(0.5).strokeColor(RULE).stroke(); if (i === xs.length - 1) doc.moveTo(R, y).lineTo(R, y + 23).stroke(); });
    headings.forEach((label, index) => text(label, xs[index] + 5, y + 8, widths[index] - 10, 7.5, true, grid || minimal || classic ? INK : "#FFFFFF", index > 1 ? "right" : "left"));
    y += 23;
  };
  ensure(65); tableHead();
  invoice.items.forEach((item, index) => {
    const name = description(item.description, invoice.invoiceType === "SUBSCRIPTION");
    const details = [!showHsnColumn && item.hsnSac && item.hsnSac !== "0" ? `HSN/SAC: ${item.hsnSac}` : "", Number(item.discount) > 0 ? `Discount: INR ${money(item.discount)}` : ""].filter(Boolean).join("  ·  ");
    const nameH = height(name, widths[1] - 12, 9);
    const detailH = details ? height(details, widths[1] - 12, 7.5) + 4 : 0;
    const rowH = Math.max(compact ? 23 : modern || minimal ? 24 : 28, nameH + detailH + (compact ? 9 : 13));
    if (y + rowH > BOTTOM) { nextPage(); tableHead(); }
    if (!grid && !minimal && index % 2 === 1) doc.rect(L, y, W, rowH).fill("#F8FAFC");
    text(String(index + 1), xs[0] + 5, y + 9, widths[0] - 10, 8, false, MUTED);
    text(name, xs[1] + 5, y + 8, widths[1] - 12, 9);
    if (details) text(details, xs[1] + 5, y + 8 + nameH + 4, widths[1] - 12, 7.5, false, MUTED);
    const quantity = Number(item.quantity).toLocaleString("en-IN", { maximumFractionDigits: 3 });
    const numericValues = invoice.chargeGst
      ? [quantity, money(item.unitPrice), String(Number(item.gstRate)), money(Number(item.cgst) + Number(item.sgst) + Number(item.igst)), money(item.lineTotal)]
      : [quantity, money(item.unitPrice), money(item.lineTotal)];
    const values = showHsnColumn ? [item.hsnSac && item.hsnSac !== "0" ? item.hsnSac : "-", ...numericValues] : numericValues;
    values.forEach((value, i) => text(value, xs[i + 2] + 4, y + 9, widths[i + 2] - 9, 8.5, i === values.length - 1, INK, "right"));
    if (grid) [...xs, R].forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowH).lineWidth(0.5).strokeColor(RULE).stroke());
    y += rowH; rule(y);
  });
  y += 12;

  const totals: Array<[string, string, boolean]> = [["Subtotal", money(invoice.subTotal), false]];
  if (Number(invoice.discountTotal)) totals.push(["Discount", `- ${money(invoice.discountTotal)}`, false]);
  if (invoice.chargeGst) {
    if (Number(invoice.discountTotal)) totals.push(["Taxable amount", money(invoice.taxableValue), false]);
    if (invoice.isInterState) totals.push(["IGST", money(invoice.igst), false]);
    else totals.push(["CGST", money(invoice.cgst), false], ["SGST", money(invoice.sgst), false]);
  }
  if (Number(invoice.roundOff)) totals.push(["Round off", money(invoice.roundOff), false]);
  totals.push(["TOTAL (INR)", money(invoice.grandTotal), true]);
  if (invoice.status !== "CANCELLED") {
    if (Number(invoice.amountPaid)) totals.push(["Amount paid", money(invoice.amountPaid), false]);
    if (Number(invoice.creditedAmount)) totals.push(["Credit adjustments", money(invoice.creditedAmount), false]);
    totals.push(["Balance due (INR)", money(Math.max(0, Number(invoice.grandTotal) - Number(invoice.amountPaid) - Number(invoice.creditedAmount))), true]);
  }
  const bank = [tenant.bankName ? `Bank: ${tenant.bankName}` : "", tenant.bankBranch ? `Branch: ${tenant.bankBranch}` : "", tenant.bankAccountNo ? `Account: ${tenant.bankAccountNo}` : "", tenant.bankIfsc ? `IFSC: ${tenant.bankIfsc}` : "", tenant.bankPayableAt ? `Payable at: ${tenant.bankPayableAt}` : ""].filter(Boolean).join("\n");
  const words = `${amountInWords(Number(invoice.grandTotal))} ONLY`;
  const leftX = classic ? L + 268 : grid ? L + 8 : L;
  const leftW = classic ? W - 268 : grid ? 260 : 275;
  const totalX = classic ? L : L + 299, totalW = classic ? 225 : W - 299;
  const totalRight = totalX + totalW;
  const leftH = 20 + height(words, leftW, 8.5) + (bank ? 26 + height(bank, leftW, 8.5) : 0);
  const summaryH = Math.max(leftH, totals.length * 21) + 14;
  ensure(summaryH);
  const summaryY = y;
  if (grid) { box(L, y - 5, W, summaryH + 5); doc.moveTo(totalX - 14, y - 5).lineTo(totalX - 14, y + summaryH).strokeColor(RULE).stroke(); }
  let leftY = text("AMOUNT IN WORDS", leftX, y + 4, leftW, 7.5, true, MUTED);
  leftY = text(words, leftX, leftY + 6, leftW, 8.5, true);
  if (bank) {
    leftY = text("BANK DETAILS", leftX, leftY + 12, leftW, 7.5, true, ACCENT);
    text(bank, leftX, leftY + 6, leftW, 8.5);
  }
  let totalY = summaryY;
  totals.forEach(([label, value, highlight]) => {
    if (grid) { rule(totalY, totalX - 7, R); }
    if (highlight && !grid) doc.roundedRect(totalX - 7, totalY, totalW + 7, 20, 3).fill(SOFT);
    text(label, totalX, totalY + 5, totalW - 82, 8.5, highlight);
    text(value, totalRight - 82, totalY + 5, 82, 9, highlight, INK, "right");
    totalY += 21;
  });
  y = summaryY + Math.max(leftH, totals.length * 21) + 18;
  const terms = invoice.terms || tenant.invoiceTerms;
  if (terms) {
    const termH = height(terms, W, 8) + 30; ensure(termH);
    rule(y); y = text("TERMS & CONDITIONS", L, y + 10, W, 7.5, true, MUTED) + 6;
    y = text(terms, L, y, W, 8, false, MUTED) + 15;
  }
  ensure(65);
  text(`For ${tenant.name}`, R - 240, y + 4, 240, 8.5, true, INK, "right");
  if (tenant.signatureUrl?.startsWith("data:image/")) {
    try { doc.image(Buffer.from(tenant.signatureUrl.split(",")[1], "base64"), R - 120, y + 20, { fit: [115, 26] }); } catch { /* Keep signature area readable. */ }
  }
  text("Authorised signatory", R - 160, y + 48, 160, 8, false, MUTED, "right");
  footer();
}
