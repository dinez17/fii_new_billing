import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import { prisma } from "@fii/database";
import { notFound } from "@fii/common";
import { renderCommercialInvoice } from "./invoice-layout.js";

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
  const setting = await prisma.setting.findUnique({ where: { tenantId_group_key: { tenantId, group: "INVOICE", key: "template" } }, select: { value: true } });
  return { invoice, tenant, template: setting?.value ?? "COMMERCIAL" };
}

type Loaded = Awaited<ReturnType<typeof loadInvoice>>;
export type InvoiceWithRelations = Loaded["invoice"];

export function renderInvoice(doc: PDFKit.PDFDocument, invoice: Loaded["invoice"], tenant: Loaded["tenant"], template = "COMMERCIAL"): void {
  renderCommercialInvoice(doc, invoice, tenant, posName(invoice.placeOfSupply), template);
}

/** Pipes the invoice PDF into any writable (e.g. an HTTP response).
 *  `onLoaded` fires before streaming starts — use it to set HTTP headers. */
export async function streamInvoicePdf(
  tenantId: string,
  invoiceId: string,
  out: Writable,
  onLoaded?: (invoice: InvoiceWithRelations) => void,
): Promise<InvoiceWithRelations> {
  const { invoice, tenant, template } = await loadInvoice(tenantId, invoiceId);
  onLoaded?.(invoice);
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  doc.pipe(out);
  renderInvoice(doc, invoice, tenant, template);
  doc.end();
  return invoice;
}

/** Renders the invoice PDF into a Buffer (email attachments etc.). */
export async function buildInvoicePdfBuffer(tenantId: string, invoiceId: string): Promise<{ buffer: Buffer; invoice: InvoiceWithRelations }> {
  const { invoice, tenant, template } = await loadInvoice(tenantId, invoiceId);
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  renderInvoice(doc, invoice, tenant, template);
  doc.end();
  return { buffer: await done, invoice };
}
