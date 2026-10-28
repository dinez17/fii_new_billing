import { z } from "zod";
import { prisma } from "@fii/database";
import { badRequest, decryptSecret, encryptSecret, notFound } from "@fii/common";

export const documentKind = z.enum(["PHOTO", "ID_FRONT", "ID_BACK", "GST_CERTIFICATE"]);
export const kycBody = z.object({
  idProofType: z.enum(["AADHAAR", "PAN", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "OTHER"]).nullable().optional(),
  idProofNumber: z.string().trim().max(80).optional(),
});
export const documentBody = z.object({ fileName: z.string().trim().min(1).max(160), dataUrl: z.string().max(1_450_000) });
export function maskId(value: string): string { return value ? `****${value.slice(-4)}` : ""; }

async function ownCustomer(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
  if (!customer) throw notFound("Customer");
}

export function decodeDocument(kind: z.infer<typeof documentKind>, dataUrl: string) {
  const match = /^data:(image\/png|image\/jpeg|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw badRequest("Choose a PNG, JPEG or PDF file");
  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.toString("base64") !== base64) throw badRequest("Invalid file encoding");
  const maximum = kind === "PHOTO" ? 500 * 1024 : 1024 * 1024;
  if (bytes.length > maximum) throw badRequest(kind === "PHOTO" ? "Photo must be 500 KB or smaller" : "Document must be 1 MB or smaller");
  if (kind === "PHOTO" && mimeType === "application/pdf") throw badRequest("Customer photo must be a PNG or JPEG image");
  const valid = mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (!valid) throw badRequest("File contents do not match the selected format");
  return { bytes, mimeType, base64 };
}

export async function getKyc(tenantId: string, customerId: string) {
  await ownCustomer(tenantId, customerId);
  const [kyc, documents] = await Promise.all([
    prisma.customerKyc.findUnique({ where: { customerId } }),
    prisma.customerDocument.findMany({ where: { customerId }, select: { kind: true, fileName: true, mimeType: true, sizeBytes: true, updatedAt: true } }),
  ]);
  return { idProofType: kyc?.idProofType ?? null, idProofNumberMasked: kyc?.idProofNumberEncrypted ? maskId(decryptSecret(kyc.idProofNumberEncrypted)) : "", documents };
}

export async function saveKyc(tenantId: string, customerId: string, actorId: string, input: z.infer<typeof kycBody>) {
  await ownCustomer(tenantId, customerId);
  const data = { idProofType: input.idProofType, ...(input.idProofNumber !== undefined ? { idProofNumberEncrypted: input.idProofNumber ? encryptSecret(input.idProofNumber) : null } : {}) };
  await prisma.$transaction([
    prisma.customerKyc.upsert({ where: { customerId }, create: { customerId, ...data }, update: data }),
    prisma.auditLog.create({ data: { tenantId, userId: actorId, action: "CUSTOMER_KYC_UPDATED", entity: "Customer", entityId: customerId, after: { idProofType: input.idProofType, numberChanged: input.idProofNumber !== undefined } } }),
  ]);
  return getKyc(tenantId, customerId);
}

export async function uploadDocument(tenantId: string, customerId: string, actorId: string, kind: z.infer<typeof documentKind>, input: z.infer<typeof documentBody>) {
  await ownCustomer(tenantId, customerId);
  const { bytes, mimeType, base64 } = decodeDocument(kind, input.dataUrl);
  const fileName = input.fileName.split(/[\\/]/).pop()!;
  const data = { fileName, mimeType, sizeBytes: bytes.length, contentEncrypted: encryptSecret(base64), uploadedById: actorId };
  await prisma.$transaction([
    prisma.customerDocument.upsert({ where: { customerId_kind: { customerId, kind } }, create: { customerId, kind, ...data }, update: data }),
    prisma.auditLog.create({ data: { tenantId, userId: actorId, action: "CUSTOMER_DOCUMENT_UPLOADED", entity: "Customer", entityId: customerId, after: { kind, fileName, mimeType, sizeBytes: bytes.length } } }),
  ]);
  return { kind, fileName, mimeType, sizeBytes: bytes.length };
}

export async function readDocument(tenantId: string, customerId: string, kind: z.infer<typeof documentKind>) {
  await ownCustomer(tenantId, customerId);
  const document = await prisma.customerDocument.findUnique({ where: { customerId_kind: { customerId, kind } } });
  if (!document) throw notFound("Customer document");
  return { bytes: Buffer.from(decryptSecret(document.contentEncrypted), "base64"), mimeType: document.mimeType, fileName: document.fileName };
}
