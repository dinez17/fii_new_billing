import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import { prisma } from "@fii/database";
import { notFound } from "@fii/common";
import { loadInvoiceCompany } from "./invoice-company.js";
import { amountInWords } from "./amount-words.js";

const inr = (v: unknown) => `Rs. ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

async function loadReceipt(tenantId: string, receiptId: string) {
  const receipt = await prisma.receipt.findFirst({
    where: { id: receiptId, tenantId },
    include: {
      payment: {
        include: {
          customer: true,
          allocations: { include: { invoice: { select: { invoiceNumber: true, grandTotal: true, chargeGst: true } } } },
        },
      },
    },
  });
  if (!receipt) throw notFound("Receipt");
  const onlyWithoutGst = receipt.payment.allocations.length > 0 && receipt.payment.allocations.every(a => !a.invoice.chargeGst);
  const tenant = await loadInvoiceCompany(tenantId, !onlyWithoutGst);
  return { receipt, tenant };
}

type Loaded = Awaited<ReturnType<typeof loadReceipt>>;
export type ReceiptWithRelations = Loaded["receipt"];

// A5 landscape geometry (595 × 420)
const L = 24, R = 571, T = 24, B = 396;
const SHADE = "#f0f2f5";

function renderReceipt(doc: PDFKit.PDFDocument, receipt: Loaded["receipt"], tenant: Loaded["tenant"]): void {
  const p = receipt.payment;
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.7) =>
    doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(w).strokeColor("#000").stroke();
  const shade = (x: number, y: number, w: number, h: number) =>
    doc.rect(x, y, w, h).fillColor(SHADE).fill().fillColor("#000");

  // outer border + title band
  doc.rect(L, T, R - L, B - T).lineWidth(1).strokeColor("#000").stroke();
  shade(L, T, R - L, 20);
  line(L, T + 20, R, T + 20);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000")
    .text(p.status === "REFUNDED" ? "REVERSED / REFUNDED RECEIPT — NOT VALID" : "PAYMENT RECEIPT", L, T + 5, { width: R - L, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8)
    .text("ORIGINAL FOR RECIPIENT", L, T + 6, { width: R - L - 8, align: "right" });

  // logo (left)
  if (tenant.logoUrl?.startsWith("data:image/")) {
    try {
      const b64 = tenant.logoUrl.slice(tenant.logoUrl.indexOf(",") + 1);
      doc.image(Buffer.from(b64, "base64"), L + 8, T + 26, { fit: [88, 44] });
    } catch { /* corrupt logo — skip */ }
  }

  // company block (right)
  let y = T + 26;
  doc.font("Helvetica-Bold").fontSize(14).text(tenant.name.toUpperCase(), L, y, { width: R - L - 8, align: "right" });
  y = doc.y + 1;
  doc.font("Helvetica").fontSize(8.5);
  const addr = [tenant.addressLine1, [tenant.city, tenant.pincode].filter(Boolean).join(" - "), tenant.phone ? `Phone : ${tenant.phone}` : null]
    .filter(Boolean).join("  ·  ");
  if (addr) { doc.text(addr, L, y, { width: R - L - 8, align: "right" }); y = doc.y; }
  if (tenant.gstin) {
    doc.font("Helvetica-Bold").fontSize(8.5).text(`GSTIN : ${tenant.gstin}`, L, y, { width: R - L - 8, align: "right" });
    y = doc.y;
  }
  y += 5;
  line(L, y, R, y);
  const sectionTop = y;

  // meta (right half)
  const MX = 330, MSEP = 425;
  const meta: Array<[string, string, boolean]> = [
    ["Receipt No", receipt.receiptNumber, true],
    ["Receipt Date", dmy(p.paymentDate), false],
    ["Payment Mode", p.mode, false],
    ["Reference", p.reference ?? "-", false],
  ];
  const rowH = 17;
  meta.forEach(([label, value, bold], i) => {
    const ry = sectionTop + i * rowH;
    doc.font("Helvetica").fontSize(8.5).text(label, MX + 6, ry + 4, { width: MSEP - MX - 10 });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).text(`:  ${value}`, MSEP, ry + 4, { width: R - MSEP - 6 });
    line(MX, ry + rowH, R, ry + rowH);
  });
  line(MX, sectionTop, MX, sectionTop + meta.length * rowH);

  // received from (left half)
  let by = sectionTop + 4;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#444").text("Received with thanks from :", L + 6, by).fillColor("#000");
  by = doc.y + 1;
  doc.font("Helvetica-Bold").fontSize(11).text(p.customer.name, L + 6, by, { width: MX - L - 14 });
  by = doc.y;
  doc.font("Helvetica").fontSize(9);
  doc.text(`Mobile : ${p.customer.phone}`, L + 6, by, { width: MX - L - 14 }); by = doc.y;
  if (p.customer.email) { doc.text(`E-Mail : ${p.customer.email}`, L + 6, by); by = doc.y; }

  const sectionBottom = Math.max(by + 5, sectionTop + meta.length * rowH);
  line(L, sectionBottom, R, sectionBottom);

  // allocations table: # | Invoice | Invoice Total | Amount Received
  const cols = { n: [L, 50], inv: [50, 280], total: [280, 420], alloc: [420, R] } as const;
  const thTop = sectionBottom;
  shade(L, thTop, R - L, 16);
  const center = (txt: string, x1: number, x2: number, yy: number, size = 8.5, bold = true) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).text(txt, x1, yy, { width: x2 - x1, align: "center" });
  };
  center("#", cols.n[0], cols.n[1], thTop + 4);
  center("Against Invoice", cols.inv[0], cols.inv[1], thTop + 4);
  center("Invoice Amount", cols.total[0], cols.total[1], thTop + 4);
  center(Number(p.tdsAmount ?? 0) > 0 ? "Cash received / TDS" : "Amount Received", cols.alloc[0], cols.alloc[1], thTop + 4);
  line(L, thTop + 16, R, thTop + 16);

  const tableBottom = B - 96;
  let ry = thTop + 21;
  if (p.allocations.length === 0) {
    doc.font("Helvetica").fontSize(9).fillColor("#555")
      .text("On account (no invoice allocation)", cols.inv[0] + 4, ry);
    doc.fillColor("#000");
  } else {
    p.allocations.slice(0, 6).forEach((a, i) => {
      center(String(i + 1), cols.n[0], cols.n[1], ry, 9, false);
      center(a.invoice.invoiceNumber, cols.inv[0], cols.inv[1], ry, 9, false);
      center(inr(a.invoice.grandTotal), cols.total[0], cols.total[1], ry, 9, false);
      doc.font("Helvetica-Bold");
      center(Number(a.tdsAmount ?? 0) > 0 ? `${inr(a.amount)} / TDS ${inr(a.tdsAmount)}` : inr(a.amount), cols.alloc[0], cols.alloc[1], ry, Number(a.tdsAmount ?? 0) > 0 ? 7 : 9, true);
      ry += 15;
    });
  }
  for (const x of [cols.n[1], cols.inv[1], cols.total[1]]) line(x, thTop, x, tableBottom);
  line(L, tableBottom, R, tableBottom);

  // amount in words (left) + received amount box (right)
  doc.font("Helvetica").fontSize(7.5).fillColor("#444").text("Amount in Words :", L + 6, tableBottom + 6);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000")
    .text(`${amountInWords(Number(p.amount))} ONLY`, L + 6, tableBottom + 16, { width: 300 });
  shade(340, tableBottom + 5, R - 340 - 6, 24);
  doc.rect(340, tableBottom + 5, R - 340 - 6, 24).lineWidth(0.8).strokeColor("#000").stroke();
  doc.font("Helvetica-Bold").fontSize(10).text("AMOUNT RECEIVED", 348, tableBottom + 12);
  doc.font("Helvetica-Bold").fontSize(11).text(inr(p.amount), 348, tableBottom + 11, { width: R - 348 - 12, align: "right" });

  if (Number(p.tdsAmount ?? 0) > 0) {
    doc.font("Helvetica-Bold").fontSize(8).text(`TDS deducted: ${inr(p.tdsAmount)}${p.tdsSection ? ` (${p.tdsSection})` : ""} | Total settled: ${inr(Number(p.amount) + Number(p.tdsAmount))}`, L + 6, tableBottom + 39, { width: 300 });
  }

  // signature + footer
  doc.font("Helvetica-Bold").fontSize(8.5)
    .text(`For ${tenant.name.toUpperCase()}`, 340, B - 52, { width: R - 340 - 8, align: "right" });
  if (tenant.signatureUrl?.startsWith("data:image/")) {
    try {
      const b64 = tenant.signatureUrl.slice(tenant.signatureUrl.indexOf(",") + 1);
      doc.image(Buffer.from(b64, "base64"), R - 110, B - 48, { fit: [100, 22] });
    } catch { /* corrupt signature — skip */ }
  }
  doc.font("Helvetica").fontSize(8).text("Authorised Signatory", 340, B - 24, { width: R - 340 - 8, align: "right" });
  line(L, B - 16, R, B - 16);
  doc.font("Helvetica").fontSize(7).fillColor("#555")
    .text("**** This is a computer generated receipt — signature not required ****", L, B - 12, { width: R - L, align: "center" });
  doc.fillColor("#000");
}

export async function streamReceiptPdf(
  tenantId: string,
  receiptId: string,
  out: Writable,
  onLoaded?: (receipt: ReceiptWithRelations) => void,
): Promise<ReceiptWithRelations> {
  const { receipt, tenant } = await loadReceipt(tenantId, receiptId);
  onLoaded?.(receipt);
  const doc = new PDFDocument({ size: "A5", layout: "landscape", margin: 0 });
  doc.pipe(out);
  renderReceipt(doc, receipt, tenant);
  doc.end();
  return receipt;
}

export async function buildReceiptPdfBuffer(tenantId: string, receiptId: string): Promise<{ buffer: Buffer; receipt: ReceiptWithRelations }> {
  const { receipt, tenant } = await loadReceipt(tenantId, receiptId);
  const doc = new PDFDocument({ size: "A5", layout: "landscape", margin: 0 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  renderReceipt(doc, receipt, tenant);
  doc.end();
  return { buffer: await done, receipt };
}
