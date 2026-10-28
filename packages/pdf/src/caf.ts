import PDFDocument from "pdfkit";
import { prisma } from "@fii/database";
import { badRequest, decryptSecret, notFound } from "@fii/common";
import { PDFDocument as MergePdf, StandardFonts, rgb } from "pdf-lib";

const proofLabels: Record<string, string> = { ID_FRONT: "ID proof - front", ID_BACK: "ID proof - back", GST_CERTIFICATE: "GST certificate" };

export async function appendCafProofs(caf: Buffer, proofs: { kind: string; mimeType: string; bytes: Buffer }[]): Promise<Buffer> {
  if (!proofs.length) return caf;
  const result = await MergePdf.load(caf);
  const font = await result.embedFont(StandardFonts.HelveticaBold);
  for (const kind of ["ID_FRONT", "ID_BACK", "GST_CERTIFICATE"]) {
    const proof = proofs.find((item) => item.kind === kind);
    if (!proof) continue;
    try {
      if (proof.mimeType === "application/pdf") {
        const source = await MergePdf.load(proof.bytes);
        if (!source.getPageCount()) throw new Error("Empty proof PDF");
        for (const page of await result.copyPages(source, source.getPageIndices())) result.addPage(page);
      } else {
        const image = proof.mimeType === "image/png" ? await result.embedPng(proof.bytes) : await result.embedJpg(proof.bytes);
        const page = result.addPage([595.28, 841.89]);
        page.drawText(proofLabels[kind], { x: 40, y: 793, size: 14, font, color: rgb(0.086, 0.196, 0.31) });
        const scaled = image.scaleToFit(515.28, 713.89);
        page.drawImage(image, { x: (595.28 - scaled.width) / 2, y: 40 + (713.89 - scaled.height) / 2, ...scaled });
      }
    } catch {
      throw badRequest(`Cannot attach ${proofLabels[kind]}. Replace it with a readable, unencrypted PDF, PNG or JPEG and download the CAF again.`);
    }
  }
  return Buffer.from(await result.save());
}

export interface CafData {
  company: { name: string; address: string; contact: string; gstin?: string | null; logoUrl?: string | null };
  customer: { code: string; name: string; phone?: string | null; email?: string | null; billingAddress?: string | null; serviceAddress?: string | null; location: string; gstTreatment: string; gstin?: string | null };
  idProofType?: string | null;
  idProofNumberMasked?: string;
  photo?: Buffer;
  documents: { kind: string; fileName: string }[];
  services: string[];
}

export async function buildCafPdf(data: CafData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `CAF ${data.customer.code}`, Author: data.company.name } });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => { doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const left = 40, right = doc.page.width - 40, width = right - left;
  const ensure = (height: number) => { if (doc.y + height > doc.page.height - 70) doc.addPage(); };
  const section = (title: string) => {
    ensure(55); const y = doc.y + 8;
    doc.rect(left, y, width, 20).fill("#eaf1f8");
    doc.fillColor("#16324f").font("Helvetica-Bold").fontSize(10).text(title, left + 8, y + 5, { width: width - 16 }); doc.y = y + 28;
  };
  const field = (label: string, value?: string | null) => {
    const text = value?.trim() || "Not provided";
    doc.font("Helvetica").fontSize(9);
    const height = Math.max(17, doc.heightOfString(text, { width: width - 126 }) + 6);
    ensure(height); const y = doc.y;
    doc.font("Helvetica-Bold").fillColor("#364152").text(label, left + 4, y, { width: 116 });
    doc.font("Helvetica").fillColor("#111827").text(text, left + 126, y, { width: width - 130 }); doc.y = y + height;
  };

  const top = doc.y;
  let companyX = left;
  if (data.company.logoUrl?.startsWith("data:image/")) {
    try { doc.image(Buffer.from(data.company.logoUrl.split(",")[1], "base64"), left, top, { fit: [45, 45] }); companyX += 55; } catch { /* logo is optional */ }
  }
  const companyWidth = right - 110 - companyX;
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#16324f").text(data.company.name, companyX, top, { width: companyWidth });
  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  if (data.company.address) doc.text(data.company.address, companyX, doc.y + 3, { width: companyWidth });
  if (data.company.contact) doc.text(data.company.contact, companyX, doc.y + 3, { width: companyWidth });
  if (data.company.gstin) doc.text(`GSTIN: ${data.company.gstin}`, companyX, doc.y + 3, { width: companyWidth });
  const companyBottom = doc.y;
  doc.rect(right - 90, top, 90, 104).lineWidth(0.7).strokeColor("#94a3b8").stroke();
  if (data.photo) {
    try { doc.image(data.photo, right - 86, top + 4, { fit: [82, 96], align: "center", valign: "center" }); }
    catch { doc.fontSize(8).text("Photo unavailable", right - 85, top + 44, { width: 80, align: "center" }); }
  } else doc.fontSize(9).text("Customer\nphoto", right - 85, top + 38, { width: 80, align: "center" });
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#16324f").text("CUSTOMER APPLICATION FORM", left, Math.max(companyBottom + 12, top + 66), { width: width - 110 });
  doc.font("Helvetica").fontSize(8).fillColor("#475569").text(`CAF / ${data.customer.code}    Generated: ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`, left, doc.y + 5, { width: width - 110 });
  doc.y = Math.max(top + 114, doc.y + 8);

  section("1. Customer details");
  field("Customer code", data.customer.code); field("Full name", data.customer.name);
  field("Contact", [data.customer.phone, data.customer.email].filter(Boolean).join(" / "));
  field("Billing address", data.customer.billingAddress);
  field("Service address", data.customer.serviceAddress || data.customer.billingAddress);
  field("City / state / PIN", data.customer.location);
  section("2. GST details");
  field("GST treatment", data.customer.gstTreatment); field("Customer GSTIN", data.customer.gstin);
  section("3. Identity proof");
  field("Proof type", data.idProofType?.replace(/_/g, " "));
  field("Reference (masked)", data.idProofNumberMasked);
  section("4. Documents in customer record");
  const names: Record<string, string> = { PHOTO: "Photo", ID_FRONT: "ID proof - front", ID_BACK: "ID proof - back", GST_CERTIFICATE: "GST certificate" };
  for (const kind of ["PHOTO", "ID_FRONT", "ID_BACK", "GST_CERTIFICATE"]) field(names[kind], data.documents.find((document) => document.kind === kind)?.fileName ?? "Not uploaded");
  section("5. Service / subscription details");
  for (const service of data.services.length ? data.services : ["No subscription assigned yet"]) field("Service", service);
  ensure(100);
  doc.moveDown(0.5); doc.font("Helvetica").fontSize(9).fillColor("#334155").text("I confirm that the information provided in this application is correct.", left, doc.y, { width });
  const signatureY = doc.y + 35;
  doc.moveTo(left, signatureY).lineTo(left + 210, signatureY).strokeColor("#64748b").stroke();
  doc.moveTo(right - 210, signatureY).lineTo(right, signatureY).stroke();
  doc.fontSize(8).text("Applicant signature / date", left, signatureY + 6, { width: 210 });
  doc.text("Received by / date", right - 210, signatureY + 6, { width: 210 });

  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page); const margin = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`CAF ${data.customer.code} | Generated from saved customer data | Page ${page + 1} of ${range.count}`, left, doc.page.height - 32, { width, align: "center", lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end(); return finished;
}

export async function buildCustomerCafPdfBuffer(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, include: {
    kyc: true, documents: { select: { kind: true, fileName: true, mimeType: true, contentEncrypted: true } },
    subscribers: { include: { plans: { where: { endDate: null }, include: { plan: true } } } },
  } });
  if (!customer) throw notFound("Customer");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const photo = await prisma.customerDocument.findUnique({ where: { customerId_kind: { customerId, kind: "PHOTO" } }, select: { contentEncrypted: true } });
  const number = customer.kyc?.idProofNumberEncrypted ? decryptSecret(customer.kyc.idProofNumberEncrypted) : "";
  const buffer = await buildCafPdf({
    company: { name: tenant.name, address: [tenant.addressLine1, tenant.addressLine2, tenant.city, tenant.pincode].filter(Boolean).join(", "), contact: [tenant.phone, tenant.email].filter(Boolean).join(" / "), gstin: tenant.gstin, logoUrl: tenant.logoUrl },
    customer: { ...customer,
      billingAddress: [customer.billingAddress, customer.city, customer.stateName, customer.pincode].filter(Boolean).join(", "),
      serviceAddress: [customer.serviceAddress, customer.installationCity, customer.installationState, customer.installationPincode].filter(Boolean).join(", "),
      location: [customer.city, customer.stateCode ? `State ${customer.stateCode}` : "", customer.pincode].filter(Boolean).join(" / ") },
    idProofType: customer.kyc?.idProofType, idProofNumberMasked: number ? `****${number.slice(-4)}` : "",
    photo: photo ? Buffer.from(decryptSecret(photo.contentEncrypted), "base64") : undefined,
    documents: customer.documents,
    services: customer.subscribers.map((subscriber) => `${subscriber.code} / ${subscriber.subscriberType} / ${subscriber.status} / ${subscriber.plans.map((mapping) => mapping.plan.name).join(", ") || "No active plan"}`),
  });
  const proofs = customer.documents.filter((document) => document.kind in proofLabels).map((document) => ({
    kind: document.kind, mimeType: document.mimeType, bytes: Buffer.from(decryptSecret(document.contentEncrypted), "base64"),
  }));
  return { buffer: await appendCafProofs(buffer, proofs), customerCode: customer.code };
}
