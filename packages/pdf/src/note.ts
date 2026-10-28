import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import { prisma } from "@fii/database";
import { notFound } from "@fii/common";
import { amountInWords } from "./amount-words.js";
import { posName } from "./invoice.js";

export type NotePdfKind = "credit" | "debit";

const n2 = (v: unknown) => Number(v).toFixed(2);
const qty = (v: unknown) => {
  const q = Number(v);
  return q % 1 === 0 ? String(q) : q.toFixed(2);
};
const dmy = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

interface NoteItem {
  description: string;
  hsnSac?: string | null;
  quantity: number;
  unitPrice: number;
  discount?: number;
  gstRate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number;
}

async function loadNote(tenantId: string, noteId: string, kind: NotePdfKind) {
  const delegate = kind === "credit" ? prisma.creditNote : prisma.debitNote;
  const note = await (delegate as typeof prisma.creditNote).findFirst({
    where: { id: noteId, tenantId },
    include: { invoice: { include: { customer: true } } },
  });
  if (!note) throw notFound(kind === "credit" ? "Credit note" : "Debit note");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { note, tenant };
}

type Loaded = Awaited<ReturnType<typeof loadNote>>;
export type NoteWithRelations = Loaded["note"];

// page geometry (A4 = 595 × 842)
const L = 30, R = 565, T = 30, B = 812;
const SHADE = "#f0f2f5";

export function renderNote(doc: PDFKit.PDFDocument, note: Loaded["note"], tenant: Loaded["tenant"], kind: NotePdfKind): void {
  const invoice = note.invoice;
  const customer = invoice.customer;
  const items = (note.items ?? []) as unknown as NoteItem[];
  const title = kind === "credit" ? "CREDIT NOTE (SALES RETURN)" : "DEBIT NOTE";

  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.7) =>
    doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(w).strokeColor("#000").stroke();
  const shade = (x: number, y: number, w: number, h: number) =>
    doc.rect(x, y, w, h).fillColor(SHADE).fill().fillColor("#000");

  doc.rect(L, T, R - L, B - T).lineWidth(1).strokeColor("#000").stroke();

  // ── Title band
  shade(L, T, R - L, 22);
  line(L, T + 22, R, T + 22);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000")
    .text(title, L, T + 6, { width: R - L, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8.5)
    .text(note.status === "CANCELLED" ? "CANCELLED" : "ORIGINAL FOR RECIPIENT", L, T + 8, { width: R - L - 10, align: "right" });

  // ── Logo
  if (tenant.logoUrl?.startsWith("data:image/")) {
    try {
      const b64 = tenant.logoUrl.slice(tenant.logoUrl.indexOf(",") + 1);
      doc.image(Buffer.from(b64, "base64"), L + 10, T + 32, { fit: [110, 62] });
    } catch { /* corrupt logo — skip */ }
  }

  // ── Company block
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

  // ── Meta (right half)
  const MX = 320, MSEP = 425;
  const meta: Array<[string, string, boolean]> = [
    [`${kind === "credit" ? "Credit" : "Debit"} Note No`, note.noteNumber, true],
    ["Note Date", dmy(note.noteDate), false],
    ["Against Invoice", invoice.invoiceNumber, true],
    ["Invoice Date", dmy(invoice.invoiceDate), false],
    ["Place of Supply", posName(invoice.placeOfSupply), false],
  ];
  const rowH = 19;
  meta.forEach(([label, value, bold], i) => {
    const ry = sectionTop + i * rowH;
    doc.font("Helvetica").fontSize(9).text(label, MX + 6, ry + 5, { width: MSEP - MX - 10 });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(`:  ${value}`, MSEP, ry + 5, { width: R - MSEP - 6 });
    line(MX, ry + rowH, R, ry + rowH);
  });
  line(MX, sectionTop, MX, sectionTop + meta.length * rowH);

  // ── Customer (left half)
  let by = sectionTop + 5;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#444").text(kind === "credit" ? "Returned By :" : "Issued To :", L + 6, by).fillColor("#000");
  by = doc.y + 1;
  doc.font("Helvetica-Bold").fontSize(11).text(customer.name, L + 6, by, { width: MX - L - 14 });
  by = doc.y + 1;
  doc.font("Helvetica").fontSize(10);
  if (customer.billingAddress) { doc.text(customer.billingAddress, L + 6, by, { width: MX - L - 14 }); by = doc.y; }
  doc.text(`Mobile : ${customer.phone}`, L + 6, by, { width: MX - L - 14 }); by = doc.y;
  if (customer.gstin) { doc.font("Helvetica-Bold").text(`GSTIN : ${customer.gstin}`, L + 6, by); by = doc.y; doc.font("Helvetica"); }
  if (customer.email) { doc.text(`E-Mail : ${customer.email}`, L + 6, by); by = doc.y; }

  const sectionBottom = Math.max(by + 6, sectionTop + meta.length * rowH);
  line(L, sectionBottom, R, sectionBottom);

  // ── Items table: # | Description | Qty | Rate | GST % | Tax Amt | Total
  const cols = { n: [L, 52], desc: [52, 280], qty: [280, 330], rate: [330, 396], p: [396, 434], tax: [434, 494], total: [494, R] } as const;
  const thTop = sectionBottom;
  const thBottom = thTop + 18;
  shade(L, thTop, R - L, 18);
  const center = (txt: string, x1: number, x2: number, yy: number, size = 8.5, bold = true) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size)
      .text(txt, x1, yy, { width: x2 - x1, align: "center" });
  };
  center("#", cols.n[0], cols.n[1], thTop + 5);
  center("Product Description", cols.desc[0], cols.desc[1], thTop + 5);
  center("Qty", cols.qty[0], cols.qty[1], thTop + 5);
  center("Rate", cols.rate[0], cols.rate[1], thTop + 5);
  center("GST %", cols.p[0], cols.p[1], thTop + 5);
  center("Tax Amt", cols.tax[0], cols.tax[1], thTop + 5);
  center("Total", cols.total[0], cols.total[1], thTop + 5);
  line(L, thBottom, R, thBottom);

  const bodyBottom = 560;
  let ry = thBottom + 5;
  let idx = 0;
  for (const it of items) {
    idx++;
    const name = it.description;
    const sub = [it.hsnSac ? `HSN/SAC : ${it.hsnSac}` : "", Number(it.discount ?? 0) > 0 ? `Discount : ${n2(it.discount)}` : ""]
      .filter(Boolean).join("   ");
    doc.font("Helvetica").fontSize(10);
    const nameH = doc.heightOfString(name, { width: cols.desc[1] - cols.desc[0] - 8 });
    const subH = sub ? 11 : 0;
    if (ry + nameH + subH > bodyBottom - 16) break;
    center(String(idx), cols.n[0], cols.n[1], ry, 10, false);
    doc.font("Helvetica").fontSize(10).text(name, cols.desc[0] + 4, ry, { width: cols.desc[1] - cols.desc[0] - 8 });
    if (sub) {
      doc.font("Helvetica").fontSize(8.5).fillColor("#555")
        .text(sub, cols.desc[0] + 4, ry + nameH + 1, { width: cols.desc[1] - cols.desc[0] - 8 });
      doc.fillColor("#000");
    }
    center(`${qty(it.quantity)} Nos`, cols.qty[0], cols.qty[1], ry, 10, false);
    center(n2(it.unitPrice), cols.rate[0], cols.rate[1], ry, 10, false);
    center(String(Number(it.gstRate)), cols.p[0], cols.p[1], ry, 10, false);
    center(n2(Number(it.cgst) + Number(it.sgst) + Number(it.igst)), cols.tax[0], cols.tax[1], ry, 10, false);
    center(n2(it.lineTotal), cols.total[0], cols.total[1], ry, 10, true);
    ry += nameH + subH + 8;
  }

  // totals row
  shade(L, bodyBottom - 15, R - L, 15);
  line(L, bodyBottom - 15, R, bodyBottom - 15);
  doc.font("Helvetica-Bold").fontSize(8.5).text("Total", cols.rate[0], bodyBottom - 11, { width: cols.rate[1] - cols.rate[0], align: "center" });
  center(n2(Number(note.cgst) + Number(note.sgst) + Number(note.igst)), cols.tax[0], cols.tax[1], bodyBottom - 11);
  center(n2(note.total), cols.total[0], cols.total[1], bodyBottom - 11);

  for (const x of [cols.n[1], cols.desc[1], cols.qty[1], cols.rate[1], cols.p[1], cols.tax[1]]) line(x, thTop, x, bodyBottom);
  line(L, bodyBottom, R, bodyBottom);

  // ── Amount in words
  doc.font("Helvetica").fontSize(8).fillColor("#444").text("Amount in Words :", L + 6, bodyBottom + 6);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
    .text(`${amountInWords(Number(note.total))} ONLY`, L + 110, bodyBottom + 5, { width: R - L - 118 });
  const wordsBottom = bodyBottom + 22;
  line(L, wordsBottom, R, wordsBottom);

  // ── Bottom: reason (left) + totals & signature (right)
  const SPLIT = 330;
  line(SPLIT, wordsBottom, SPLIT, B - 32);

  let ly = wordsBottom + 8;
  doc.font("Helvetica-Bold").fontSize(8).text("REASON", L + 6, ly, { underline: true });
  ly = doc.y + 2;
  doc.font("Helvetica").fontSize(9).fillColor("#333")
    .text(note.reason, L + 6, ly, { width: SPLIT - L - 14, height: 60, ellipsis: true });
  ly = doc.y + 10;
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#555")
    .text(kind === "credit"
      ? "This credit note reduces the amount receivable against the invoice referenced above. GST liability is adjusted accordingly."
      : "This debit note increases the amount receivable against the invoice referenced above. GST liability is adjusted accordingly.",
      L + 6, ly, { width: SPLIT - L - 14 });
  doc.fillColor("#000");

  // totals box
  let ty = wordsBottom;
  const totalRows: Array<[string, string, boolean]> = [
    ["TAXABLE VALUE", n2(note.taxableValue), false],
    ...(Number(note.igst) > 0
      ? [["IGST", n2(note.igst), false] as [string, string, boolean]]
      : [["CGST", n2(note.cgst), false] as [string, string, boolean], ["SGST", n2(note.sgst), false] as [string, string, boolean]]),
    [`${kind === "credit" ? "CREDIT" : "DEBIT"} TOTAL`, n2(note.total), true],
  ];
  for (const [label, value, bold] of totalRows) {
    const rh = bold ? 22 : 19;
    if (bold) shade(SPLIT + 0.5, ty + 0.5, R - SPLIT - 1, rh - 1);
    doc.font("Helvetica-Bold").fontSize(bold ? 10.5 : 9).text(label, SPLIT + 6, ty + 5);
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10.5 : 9)
      .text(value, SPLIT + 120, ty + 5, { width: R - SPLIT - 128, align: "right" });
    ty += rh;
    line(SPLIT, ty, R, ty);
  }

  // signature
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
    .text(`**** This is a computer generated ${kind} note — signature not required ****`, L, B - 20, { width: R - L, align: "center" });
  doc.fillColor("#000");

  // ── CANCELLED watermark
  if (note.status === "CANCELLED") {
    doc.save();
    doc.rotate(-30, { origin: [297, 420] });
    doc.font("Helvetica-Bold").fontSize(84).fillColor("#b91c1c").fillOpacity(0.10)
      .text("CANCELLED", 297 - 250, 420 - 42, { width: 500, align: "center" });
    doc.restore();
    doc.fillOpacity(1).fillColor("#000");
  }
}

/** Pipes the note PDF into any writable (e.g. an HTTP response). */
export async function streamNotePdf(
  tenantId: string,
  noteId: string,
  kind: NotePdfKind,
  out: Writable,
  onLoaded?: (note: NoteWithRelations) => void,
): Promise<NoteWithRelations> {
  const { note, tenant } = await loadNote(tenantId, noteId, kind);
  onLoaded?.(note);
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  doc.pipe(out);
  renderNote(doc, note, tenant, kind);
  doc.end();
  return note;
}

/** Renders the note PDF into a Buffer (email attachments etc.). */
export async function buildNotePdfBuffer(tenantId: string, noteId: string, kind: NotePdfKind): Promise<{ buffer: Buffer; note: NoteWithRelations }> {
  const { note, tenant } = await loadNote(tenantId, noteId, kind);
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  renderNote(doc, note, tenant, kind);
  doc.end();
  return { buffer: await done, note };
}
