import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import { prisma } from "@fii/database";
import { notFound } from "@fii/common";
import { amountInWords } from "./amount-words.js";

const n2 = (v: unknown) => Number(v).toFixed(2);
const qty = (v: unknown) => {
  const q = Number(v);
  return q % 1 === 0 ? String(q) : q.toFixed(2);
};
const dmy = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

const STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra & Nagar Haveli & Daman & Diu", "27": "Maharashtra",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};
export const posName = (code: string) => (STATES[code] ? `${code}-${STATES[code]}` : code);

async function loadInvoice(tenantId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { items: true, customer: true },
  });
  if (!invoice) throw notFound("Invoice");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { invoice, tenant };
}

type Loaded = Awaited<ReturnType<typeof loadInvoice>>;
export type InvoiceWithRelations = Loaded["invoice"];

// page geometry (A4 = 595 × 842)
const L = 30, R = 565, T = 30, B = 812;
const SHADE = "#f0f2f5"; // light header/total shading
const RULE = "#000";

export function renderInvoice(doc: PDFKit.PDFDocument, invoice: Loaded["invoice"], tenant: Loaded["tenant"]): void {
  const inter = invoice.isInterState;
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.7) =>
    doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(w).strokeColor(RULE).stroke();
  const shade = (x: number, y: number, w: number, h: number) =>
    doc.rect(x, y, w, h).fillColor(SHADE).fill().fillColor("#000");

  // outer border
  doc.rect(L, T, R - L, B - T).lineWidth(1).strokeColor(RULE).stroke();

  // ── Title band (shaded)
  shade(L, T, R - L, 22);
  line(L, T + 22, R, T + 22);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000")
    .text("TAX INVOICE", L, T + 6, { width: R - L, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8.5)
    .text(invoice.status === "CANCELLED" ? "CANCELLED" : "ORIGINAL FOR RECIPIENT", L, T + 8, { width: R - L - 10, align: "right" });

  // ── Logo (top-left)
  if (tenant.logoUrl?.startsWith("data:image/")) {
    try {
      const b64 = tenant.logoUrl.slice(tenant.logoUrl.indexOf(",") + 1);
      doc.image(Buffer.from(b64, "base64"), L + 10, T + 32, { fit: [110, 62] });
    } catch { /* corrupt logo — skip */ }
  }

  // ── Company block (right aligned)
  let y = T + 30;
  doc.font("Helvetica-Bold").fontSize(17).text(tenant.name.toUpperCase(), L, y, { width: R - L - 10, align: "right" });
  y = doc.y + 2;
  doc.font("Helvetica").fontSize(10).fillColor("#000");
  for (const lineTxt of [tenant.addressLine1, tenant.addressLine2, [tenant.city, tenant.pincode].filter(Boolean).join(" - ")]) {
    if (lineTxt) { doc.text(lineTxt, L, y, { width: R - L - 10, align: "right" }); y = doc.y; }
  }
  const contact = [tenant.phone ? `Phone : ${tenant.phone}` : null, tenant.email ? `E-Mail : ${tenant.email}` : null]
    .filter(Boolean).join("   |   ");
  if (contact) { doc.text(contact, L, y, { width: R - L - 10, align: "right" }); y = doc.y; }
  if (tenant.gstin) {
    doc.font("Helvetica-Bold").fontSize(9.5).text(`GSTIN : ${tenant.gstin}`, L, y, { width: R - L - 10, align: "right" });
    y = doc.y;
  }
  y += 6;
  line(L, y, R, y);
  const sectionTop = y;

  // ── Meta table (right half)
  const MX = 320, MSEP = 425;
  const period = invoice.periodStart && invoice.periodEnd
    ? `${dmy(invoice.periodStart)} to ${dmy(invoice.periodEnd)}`
    : null;
  const meta: Array<[string, string, boolean]> = [
    ["Invoice No", invoice.invoiceNumber, true],
    ["Date of Invoice", dmy(invoice.invoiceDate), false],
    ["Due Date", dmy(invoice.dueDate), true],
    ["Place of Supply", posName(invoice.placeOfSupply), false],
    ...(period ? [["Billing Period", period, false] as [string, string, boolean]] : []),
    ["P.O. No", invoice.poNumber ?? "-", false],
  ];
  let metaBottom = sectionTop;
  meta.forEach(([label, value, bold]) => {
    const ry = metaBottom;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    const rowH = Math.max(19, doc.heightOfString(`:  ${value}`, { width: R - MSEP - 6 }) + 10);
    doc.font("Helvetica").fontSize(9).text(label, MX + 6, ry + 5, { width: MSEP - MX - 10 });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(`:  ${value}`, MSEP, ry + 5, { width: R - MSEP - 6 });
    line(MX, ry + rowH, R, ry + rowH);
    metaBottom += rowH;
  });
  line(MX, sectionTop, MX, metaBottom);

  // ── Bill To (left half)
  let by = sectionTop + 5;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#444").text("Bill To :", L + 6, by).fillColor("#000");
  by = doc.y + 1;
  doc.font("Helvetica-Bold").fontSize(11).text(invoice.customer.name, L + 6, by, { width: MX - L - 14 });
  by = doc.y + 1;
  doc.font("Helvetica").fontSize(10);
  if (invoice.customer.billingAddress) { doc.text(invoice.customer.billingAddress, L + 6, by, { width: MX - L - 14 }); by = doc.y; }
  doc.text(`Mobile : ${invoice.customer.phone}`, L + 6, by, { width: MX - L - 14 }); by = doc.y;
  if (invoice.customer.gstin) { doc.font("Helvetica-Bold").text(`GSTIN : ${invoice.customer.gstin}`, L + 6, by); by = doc.y; doc.font("Helvetica"); }
  if (invoice.customer.email) { doc.text(`E-Mail : ${invoice.customer.email}`, L + 6, by); by = doc.y; }

  const sectionBottom = Math.max(by + 6, metaBottom);
  line(L, sectionBottom, R, sectionBottom);

  // ── Items table — columns depend on intra/inter state
  const cols = inter
    ? { n: [L, 52], desc: [52, 250], qty: [250, 300], rate: [300, 360], p1: [360, 392], a1: [392, 470], total: [470, R] }
    : { n: [L, 52], desc: [52, 240], qty: [240, 286], rate: [286, 340], p1: [340, 366], a1: [366, 416], p2: [416, 442], a2: [442, 494], total: [494, R] };

  const thTop = sectionBottom;
  const h1 = 13, h2 = 13;
  const thBottom = thTop + h1 + h2;
  shade(L, thTop, R - L, h1 + h2);
  const center = (txt: string, x1: number, x2: number, yy: number, size = 8.5, bold = true) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size)
      .text(txt, x1, yy, { width: x2 - x1, align: "center" });
  };
  center("#", cols.n[0], cols.n[1], thTop + 9);
  center("Product Description", cols.desc[0], cols.desc[1], thTop + 9);
  center("Qty", cols.qty[0], cols.qty[1], thTop + 9);
  center("Rate", cols.rate[0], cols.rate[1], thTop + 9);
  if (inter) {
    center("IGST", cols.p1[0], cols.a1[1], thTop + 3);
    center("%", cols.p1[0], cols.p1[1], thTop + h1 + 3);
    center("AMT", cols.a1[0], cols.a1[1], thTop + h1 + 3);
  } else {
    const c = cols as Record<string, number[]>;
    center("CGST", c.p1[0], c.a1[1], thTop + 3);
    center("SGST", c.p2[0], c.a2[1], thTop + 3);
    center("%", c.p1[0], c.p1[1], thTop + h1 + 3);
    center("AMT", c.a1[0], c.a1[1], thTop + h1 + 3);
    center("%", c.p2[0], c.p2[1], thTop + h1 + 3);
    center("AMT", c.a2[0], c.a2[1], thTop + h1 + 3);
  }
  center("Total", cols.total[0], cols.total[1], thTop + 9);
  line(L, thBottom, R, thBottom);
  // mid line under group headers (tax cols only)
  line(cols.p1[0], thTop + h1, (inter ? cols.a1[1] : (cols as Record<string, number[]>).a2[1]), thTop + h1);

  // table body — fixed frame down to totals row
  const bodyBottom = 585;
  let ry = thBottom + 5;
  let idx = 0;
  for (const it of invoice.items) {
    idx++;
    const name = it.description;
    const sub = [it.hsnSac ? `HSN/SAC : ${it.hsnSac}` : "", Number(it.discount) > 0 ? `Discount : ${n2(it.discount)}` : ""]
      .filter(Boolean).join("   ");
    doc.font("Helvetica").fontSize(10);
    const nameH = doc.heightOfString(name, { width: cols.desc[1] - cols.desc[0] - 8 });
    const subH = sub ? 11 : 0;
    if (ry + nameH + subH > bodyBottom - 16) break; // overflow guard — subscription invoices are short
    center(String(idx), cols.n[0], cols.n[1], ry, 10, false);
    doc.font("Helvetica").fontSize(10).text(name, cols.desc[0] + 4, ry, { width: cols.desc[1] - cols.desc[0] - 8 });
    if (sub) {
      doc.font("Helvetica").fontSize(8.5).fillColor("#555")
        .text(sub, cols.desc[0] + 4, ry + nameH + 1, { width: cols.desc[1] - cols.desc[0] - 8 });
      doc.fillColor("#000");
    }
    center(`${qty(it.quantity)} Nos`, cols.qty[0], cols.qty[1], ry, 10, false);
    center(n2(it.unitPrice), cols.rate[0], cols.rate[1], ry, 10, false);
    if (inter) {
      center(String(Number(it.gstRate)), cols.p1[0], cols.p1[1], ry, 10, false);
      center(n2(it.igst), cols.a1[0], cols.a1[1], ry, 10, false);
    } else {
      const c = cols as Record<string, number[]>;
      const half = Number(it.gstRate) / 2;
      center(String(half % 1 ? half.toFixed(1) : half), c.p1[0], c.p1[1], ry, 10, false);
      center(n2(it.cgst), c.a1[0], c.a1[1], ry, 10, false);
      center(String(half % 1 ? half.toFixed(1) : half), c.p2[0], c.p2[1], ry, 10, false);
      center(n2(it.sgst), c.a2[0], c.a2[1], ry, 10, false);
    }
    doc.font("Helvetica-Bold");
    center(n2(it.lineTotal), cols.total[0], cols.total[1], ry, 10, true);
    ry += nameH + subH + 8;
  }

  // tax totals row at the bottom of the grid (shaded)
  shade(L, bodyBottom - 15, R - L, 15);
  line(L, bodyBottom - 15, R, bodyBottom - 15);
  doc.font("Helvetica-Bold").fontSize(8.5).text("Total", cols.rate[0], bodyBottom - 11, { width: cols.rate[1] - cols.rate[0], align: "center" });
  if (inter) {
    center(n2(invoice.igst), cols.a1[0], cols.a1[1], bodyBottom - 11);
  } else {
    const c = cols as Record<string, number[]>;
    center(n2(invoice.cgst), c.a1[0], c.a1[1], bodyBottom - 11);
    center(n2(invoice.sgst), c.a2[0], c.a2[1], bodyBottom - 11);
  }
  center(n2(invoice.grandTotal), cols.total[0], cols.total[1], bodyBottom - 11);

  // vertical grid lines (header top → totals row bottom)
  const vxs = inter
    ? [cols.n[1], cols.desc[1], cols.qty[1], cols.rate[1], cols.p1[1], cols.a1[1]]
    : [cols.n[1], cols.desc[1], cols.qty[1], cols.rate[1],
       (cols as Record<string, number[]>).p1[1], (cols as Record<string, number[]>).a1[1],
       (cols as Record<string, number[]>).p2[1], (cols as Record<string, number[]>).a2[1]];
  for (const x of vxs) line(x, thTop, x, bodyBottom);
  line(L, bodyBottom, R, bodyBottom);

  // ── Amount in words
  doc.font("Helvetica").fontSize(8).fillColor("#444").text("Amount in Words :", L + 6, bodyBottom + 6);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
    .text(`${amountInWords(Number(invoice.grandTotal))} ONLY`, L + 110, bodyBottom + 5, { width: R - L - 118 });
  const wordsBottom = bodyBottom + 22;
  line(L, wordsBottom, R, wordsBottom);

  // ── Bottom: declaration/terms/bank (left) + totals & signature (right)
  const SPLIT = 330;
  line(SPLIT, wordsBottom, SPLIT, B - 32);

  // bank details are bottom-anchored so every row always fits;
  // terms get whatever space remains (truncated with … if too long)
  const bank: Array<[string, string]> = (tenant.bankName || tenant.bankAccountNo)
    ? ([
        ["Payable At", tenant.bankPayableAt ?? tenant.name],
        ["Bank Name", tenant.bankName],
        ["Branch", tenant.bankBranch],
        ["Account No", tenant.bankAccountNo],
        ["IFSC Code", tenant.bankIfsc],
      ].filter(([, v]) => Boolean(v)) as Array<[string, string]>)
    : [];
  const bankTop = bank.length > 0 ? B - 36 - bank.length * 11 - 15 : B - 36;

  let ly = wordsBottom + 8;
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(8).text("E. & O.E. — Terms & Conditions", L + 6, ly, { underline: true });
  ly = doc.y + 2;
  doc.font("Helvetica").fontSize(7.5).fillColor("#333")
    .text(invoice.terms ?? tenant.invoiceTerms ?? "1. Payment is required within the stipulated due date from the issuance of the invoice.",
      L + 6, ly, { width: SPLIT - L - 14, height: Math.max(10, bankTop - ly - 6), ellipsis: true });
  // compact declaration — only when there is room left above the bank block
  if (doc.y + 24 < bankTop) {
    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555")
      .text("Declaration : We declare that this invoice shows the actual price of the goods/services described and that all particulars are true and correct.",
        L + 6, doc.y + 6, { width: SPLIT - L - 14, height: bankTop - doc.y - 10, ellipsis: true });
    doc.fillColor("#000");
  }

  if (bank.length > 0) {
    let byy = bankTop;
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(8).text("BANK DETAILS", L + 6, byy, { underline: true });
    byy += 15;
    for (const [label, value] of bank) {
      doc.font("Helvetica").fontSize(8).fillColor("#444").text(label, L + 6, byy, { lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text(`:  ${value}`, L + 78, byy, { width: SPLIT - L - 86, lineBreak: false });
      byy += 11;
    }
  }

  // ── Totals box (right column)
  let ty = wordsBottom;
  const paid = Number(invoice.amountPaid);
  const totalRows: Array<[string, string, "normal" | "total" | "due"]> = [
    ["SUB TOTAL", n2(invoice.taxableValue), "normal"],
    ["TAX AMOUNT", n2(Number(invoice.cgst) + Number(invoice.sgst) + Number(invoice.igst)), "normal"],
    ...(Number(invoice.roundOff) !== 0 ? [["ROUND OFF", n2(invoice.roundOff), "normal"] as [string, string, "normal"]] : []),
    ["TOTAL AMOUNT", n2(invoice.grandTotal), "total"],
    ...(paid > 0 && invoice.status !== "CANCELLED"
      ? [
          ["AMOUNT PAID", n2(paid), "normal"] as [string, string, "normal"],
          ["BALANCE DUE", n2(Number(invoice.grandTotal) - paid), "due"] as [string, string, "due"],
        ]
      : []),
  ];
  for (const [label, value, kind] of totalRows) {
    const rh = kind === "total" ? 22 : 19;
    if (kind === "total") shade(SPLIT + 0.5, ty + 0.5, R - SPLIT - 1, rh - 1);
    doc.font("Helvetica-Bold").fontSize(kind === "total" ? 10.5 : 9).fillColor("#000").text(label, SPLIT + 6, ty + 5);
    doc.font(kind === "normal" ? "Helvetica" : "Helvetica-Bold").fontSize(kind === "total" ? 10.5 : 9)
      .text(value, SPLIT + 120, ty + 5, { width: R - SPLIT - 128, align: "right" });
    ty += rh;
    line(SPLIT, ty, R, ty);
  }

  // ── Signature block (right column, below the totals box)
  const sigTop = Math.max(B - 88, ty + 6);
  doc.font("Helvetica-Bold").fontSize(8.5)
    .text(`For ${tenant.name.toUpperCase()}`, SPLIT + 6, sigTop, { width: R - SPLIT - 12, align: "right" });
  if (tenant.signatureUrl?.startsWith("data:image/")) {
    try {
      const b64 = tenant.signatureUrl.slice(tenant.signatureUrl.indexOf(",") + 1);
      doc.image(Buffer.from(b64, "base64"), R - 130, sigTop + 12, { fit: [118, 34] });
    } catch { /* corrupt signature — skip */ }
  }
  doc.font("Helvetica").fontSize(8)
    .text("Authorised Signatory", SPLIT + 6, B - 42, { width: R - SPLIT - 12, align: "right" });

  // ── Footer
  line(L, B - 30, R, B - 30);
  doc.font("Helvetica").fontSize(7.5).fillColor("#555")
    .text("**** This is a computer generated invoice — signature not required ****", L, B - 20, { width: R - L, align: "center" });
  doc.fillColor("#000");

  // ── Status watermark (CANCELLED / PAID)
  if (invoice.status === "CANCELLED" || invoice.status === "PAID") {
    const word = invoice.status;
    doc.save();
    doc.rotate(-30, { origin: [297, 420] });
    doc.font("Helvetica-Bold").fontSize(84).fillColor(word === "PAID" ? "#1a7f37" : "#b91c1c").fillOpacity(0.10)
      .text(word, 297 - 250, 420 - 42, { width: 500, align: "center" });
    doc.restore();
    doc.fillOpacity(1).fillColor("#000");
  }
}

/** Pipes the invoice PDF into any writable (e.g. an HTTP response).
 *  `onLoaded` fires before streaming starts — use it to set HTTP headers. */
export async function streamInvoicePdf(
  tenantId: string,
  invoiceId: string,
  out: Writable,
  onLoaded?: (invoice: InvoiceWithRelations) => void,
): Promise<InvoiceWithRelations> {
  const { invoice, tenant } = await loadInvoice(tenantId, invoiceId);
  onLoaded?.(invoice);
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  doc.pipe(out);
  renderInvoice(doc, invoice, tenant);
  doc.end();
  return invoice;
}

/** Renders the invoice PDF into a Buffer (email attachments etc.). */
export async function buildInvoicePdfBuffer(tenantId: string, invoiceId: string): Promise<{ buffer: Buffer; invoice: InvoiceWithRelations }> {
  const { invoice, tenant } = await loadInvoice(tenantId, invoiceId);
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  renderInvoice(doc, invoice, tenant);
  doc.end();
  return { buffer: await done, invoice };
}
