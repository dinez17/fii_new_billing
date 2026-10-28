import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@fii/database";
import { getKyc, readDocument, saveKyc, uploadDocument } from "../src/services/customer-kyc.service.js";
import { buildCustomerCafPdfBuffer } from "@fii/pdf";

const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
d("customer KYC and CAF isolation", () => {
  let tenantId = "", customerId = "", otherTenantId = "", actorId = "";
  const stamp = Date.now();
  const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ4QAAAAASUVORK5CYII=";
  beforeAll(async () => {
    vi.stubEnv("MASTER_ENCRYPTION_KEY", "12".repeat(32));
    tenantId = (await prisma.tenant.create({ data: { name: "CAF Test Company", subdomain: `caf-it-${stamp}` } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { name: "Other CAF Company", subdomain: `caf-other-${stamp}` } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, name: "CAF tester", email: "caf@example.test", passwordHash: "test-not-a-login" } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "C-CAF", name: "Sample CAF Customer", phone: "9000000001" } })).id;
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });
  it("encrypts ID numbers and returns only masked references", async () => {
    await saveKyc(tenantId, customerId, actorId, { idProofType: "OTHER", idProofNumber: "PRIVATE-TEST-5678" });
    const stored = await prisma.customerKyc.findUniqueOrThrow({ where: { customerId } });
    expect(stored.idProofNumberEncrypted).not.toContain("PRIVATE-TEST-5678");
    expect((await getKyc(tenantId, customerId)).idProofNumberMasked).toBe("****5678");
  });
  it("encrypts and replaces uploads without leaking their bytes in metadata", async () => {
    await uploadDocument(tenantId, customerId, actorId, "PHOTO", { fileName: "photo.png", dataUrl: photo });
    await uploadDocument(tenantId, customerId, actorId, "PHOTO", { fileName: "updated-photo.png", dataUrl: photo });
    const stored = await prisma.customerDocument.findMany({ where: { customerId } });
    expect(stored).toHaveLength(1);
    expect(stored[0].contentEncrypted).not.toContain(photo.split(",")[1]);
    const result = await getKyc(tenantId, customerId);
    expect(JSON.stringify(result)).not.toContain("contentEncrypted");
    expect((await readDocument(tenantId, customerId, "PHOTO")).bytes.toString("base64")).toBe(photo.split(",")[1]);
  });
  it("blocks cross-tenant reads, updates, downloads and CAF generation", async () => {
    await expect(getKyc(otherTenantId, customerId)).rejects.toThrow("Customer not found");
    await expect(saveKyc(otherTenantId, customerId, actorId, { idProofType: "PAN" })).rejects.toThrow("Customer not found");
    await expect(readDocument(otherTenantId, customerId, "PHOTO")).rejects.toThrow("Customer not found");
    await expect(buildCustomerCafPdfBuffer(otherTenantId, customerId)).rejects.toThrow("Customer not found");
  });
});
