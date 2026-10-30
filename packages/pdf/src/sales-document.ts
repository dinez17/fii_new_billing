import PDFDocument from "pdfkit";
import { prisma, type Customer, type SalesDocument, type Tenant } from "@fii/database";
import { notFound, type GstTotals } from "@fii/common";
import { loadInvoiceCompany } from "./invoice-company.js";
import { amountInWords } from "./amount-words.js";

type Document = SalesDocument & { customer: Customer };
interface Item { description: string; hsnSac?: string; quantity: number; unitPrice: number; discount: number; gstRate: number }
const date = (value: Date) => value.toISOString().slice(0, 10).split("-").reverse().join("-");
const money = (value: unknown) => Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Independent non-accounting renderer; no invoice rows or ledger events are created. */
export function renderSalesDocument(doc: PDFKit.PDFDocument, record: Document, company: Tenant): void {
  const left = 34, right = 561, width = right - left, ink = "#19334b", muted = "#5c6c7c";
  let y = 34;
  const totals = record.totals as unknown as GstTotals, items = record.items as unknown as Item[];
  const title = record.kind === "QUOTATION" ? "QUOTATION" : "PROFORMA INVOICE";
  const rule = (at: number) => doc.moveTo(left, at).lineTo(right, at).lineWidth(.6).strokeColor("#d9e2ea").stroke();
  const ensure = (height: number) => { if (y + height > 770) { doc.addPage(); y = 36; doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text(`${title} · ${record.documentNumber}`, left, y); y += 25; } };
  const text = (value: string, x: number, top: number, w: number, size = 9, bold = false, align: "left" | "right" = "left") => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(ink).text(value, x, top, { width: w, align, lineGap: 2 }); return doc.y;
  };
  doc.rect(left, y, width, 3).fillColor("#087f8c").fill(); y += 15;
  let companyX = left;
  if (company.logoUrl?.startsWith("data:image/")) {
    try { doc.image(Buffer.from(company.logoUrl.split(",")[1], "base64"), left, y, { fit: [48, 48] }); companyX += 60; } catch { /* Invalid optional logo does not prevent printing. */ }
  }
  let companyY = text(company.name, companyX, y, 285 - (companyX - left), 15, true) + 5;
  const companyAddress = [company.addressLine1, company.addressLine2, [company.city, company.pincode].filter(Boolean).join(" - "), [company.phone, company.email].filter(Boolean).join(" | "), record.chargeGst && company.gstin ? `GSTIN: ${company.gstin}` : ""].filter(Boolean).join("\n");
  companyY = text(companyAddress, companyX, companyY, 285 - (companyX - left), 8);
  let metaY = text(title, 343, y, 218, 16, true, "right") + 7;
  metaY = text(record.documentNumber, 343, metaY, 218, 11, true, "right") + 5;
  metaY = text(`Date: ${date(record.documentDate)}\nValid until: ${date(record.validUntil)}\n${record.chargeGst ? "GST estimate" : "Without GST"} · ${record.status}`, 343, metaY, 218, 8.5, false, "right");
  y = Math.max(companyY, metaY, y + 70) + 16; rule(y); y += 14;
  text("PREPARED FOR", left, y, 250, 8, true); text("INSTALLATION / SERVICE ADDRESS", 310, y, 251, 8, true); y += 17;
  const c = record.customer;
  const billing = [c.name, c.billingAddress, [c.city, c.stateName, c.pincode].filter(Boolean).join(", "), c.phone, record.chargeGst && c.gstin ? `GSTIN: ${c.gstin}` : ""].filter(Boolean).join("\n");
  const installation = [c.name, c.serviceAddress || "Same as billing address", [c.installationCity, c.installationState, c.installationPincode].filter(Boolean).join(", ")].filter(Boolean).join("\n");
  y = Math.max(text(billing, left, y, 248), text(installation, 310, y, 251)) + 16;
  if (record.subject) { ensure(42); y = text(record.subject, left, y, width, 11, true) + 10; }
  if (record.poNumber) { y = text(`PO reference: ${record.poNumber}`, left, y, width, 9) + 10; }
  const header = () => { ensure(35); doc.rect(left, y, width, 25).fillColor("#eef4f8").fill(); text("DESCRIPTION / HSN", left + 7, y + 8, 230, 8, true); text("QTY", 282, y + 8, 40, 8, true, "right"); text("RATE", 329, y + 8, 68, 8, true, "right"); text("GST %", 403, y + 8, 48, 8, true, "right"); text("AMOUNT", 462, y + 8, 92, 8, true, "right"); y += 30; };
  header();
  items.forEach((item, index) => {
    doc.font("Helvetica").fontSize(9);
    const description = item.description + (item.hsnSac ? `\nHSN/SAC: ${item.hsnSac}` : "") + (item.discount ? `\nDiscount: INR ${money(item.discount)}` : "");
    const height = Math.max(39, doc.heightOfString(description, { width: 230, lineGap: 2 }) + 16);
    if (y + height > 750) { doc.addPage(); y = 36; text(`${title} · ${record.documentNumber}`, left, y, width, 10, true); y += 25; header(); }
    text(description, left + 7, y + 5, 230); text(String(item.quantity), 282, y + 5, 40, 9, false, "right"); text(money(item.unitPrice), 329, y + 5, 68, 9, false, "right"); text(record.chargeGst ? String(item.gstRate) : "—", 403, y + 5, 48, 9, false, "right"); text(money(totals.lines[index].lineTotal), 462, y + 5, 92, 9, true, "right"); y += height; rule(y);
  });
  y += 14;
  const summary: [string, string][] = [["Subtotal", totals.subTotal]];
  if (Number(totals.discountTotal)) summary.push(["Discount", totals.discountTotal], ["Taxable value", totals.taxableValue]);
  if (record.chargeGst) for (const [label, value] of [["CGST", totals.cgst], ["SGST", totals.sgst], ["IGST", totals.igst]]) if (Number(value)) summary.push([label, value]);
  if (Number(totals.roundOff)) summary.push(["Round off", totals.roundOff]);
  ensure(summary.length * 17 + 45);
  for (const [label, value] of summary) { text(label, 338, y, 110, 9); text(money(value), 454, y, 100, 9, false, "right"); y += 17; }
  doc.rect(329, y - 2, 232, 28).fillColor("#edf5f6").fill(); text("TOTAL INR", 338, y + 6, 100, 10, true); text(money(totals.grandTotal), 440, y + 6, 114, 12, true, "right"); y += 40;
  ensure(50); y = text(`Amount in words: ${amountInWords(Number(totals.grandTotal))}`, left, y, width, 9, true) + 14;
  const paragraph = (heading: string, value: string) => {
    // Split paragraphs/long terms into safe blocks so every line remains printable.
    for (const [index, line] of value.split(/\n/).entries()) {
      doc.font("Helvetica").fontSize(8.5); const height = doc.heightOfString(line || " ", { width, lineGap: 2 }) + 5;
      ensure(height + (index === 0 ? 22 : 0)); if (index === 0) { text(heading, left, y, width, 9, true); y += 19; }
      y = text(line || " ", left, y, width, 8.5) + 5;
    }
    y += 8;
  };
  if (record.kind === "PROFORMA" && company.bankAccountNo) paragraph("BANK DETAILS", [company.bankName, `Account: ${company.bankAccountNo}`, company.bankIfsc ? `IFSC: ${company.bankIfsc}` : "", company.bankBranch].filter(Boolean).join("\n"));
  if (record.notes) paragraph("NOTES", record.notes);
  if (record.terms) paragraph("TERMS & CONDITIONS", record.terms);
  if (record.cancelReason) paragraph("CANCELLATION REASON", record.cancelReason);
  ensure(65); text(`For ${company.name}`, 310, y + 12, 251, 9, true, "right"); text("Authorised signatory", 310, y + 40, 251, 8, false, "right");
  const pages = doc.bufferedPageRange();
  for (let page = pages.start; page < pages.start + pages.count; page++) { doc.switchToPage(page); rule(792); doc.font("Helvetica").fontSize(7).fillColor(muted).text("This is not a tax invoice. No stock or accounting entry is posted until invoiced.", left, 801, { width: width - 65 }); doc.text(`${page + 1} / ${pages.count}`, right - 45, 801, { width: 45, align: "right" }); }
}

export async function buildSalesDocumentPdfBuffer(tenantId: string, id: string) {
  const record = await prisma.salesDocument.findFirst({ where: { tenantId, id }, include: { customer: true } });
  if (!record) throw notFound("Sales document");
  const company = await loadInvoiceCompany(tenantId, record.chargeGst);
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true }); const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => { doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  renderSalesDocument(doc, record, company); doc.end(); return { buffer: await finished, document: record };
}
