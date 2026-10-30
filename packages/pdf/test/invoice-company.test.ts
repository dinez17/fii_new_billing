import { describe, expect, it } from "vitest";
import type { Tenant } from "@fii/database";
import { resolveInvoiceCompany } from "../src/invoice-company.js";
import { nonGstCompanySchema } from "@fii/common";

const tenant = { id: "tenant-a", name: "GST Company", gstin: "33AAACT2664C1ZS", bankName: "GST Bank", bankAccountNo: "000123", logoUrl: "GST logo", signatureUrl: "GST signature", email: "gst@example.test" } as Tenant;
describe("without-GST document identity", () => {
  const profile = { enabled: "true", name: "Independent Services", bankName: "Separate Bank", bankAccountNo: "000456", email: "billing@example.test" };
  it("keeps GST invoices on the original tenant profile", () => {
    expect(resolveInvoiceCompany(tenant, true, profile)).toBe(tenant);
  });
  it("uses independent details without changing tenant accounting ownership", () => {
    const result = resolveInvoiceCompany(tenant, false, profile);
    expect(result).toMatchObject({ id: "tenant-a", name: "Independent Services", gstin: null, bankName: "Separate Bank", bankAccountNo: "000456", email: "billing@example.test", logoUrl: null, signatureUrl: null });
    expect(tenant.name).toBe("GST Company"); expect(tenant.bankAccountNo).toBe("000123");
  });
  it("never inherits a GST bank account when an enabled profile leaves it blank", () => {
    expect(resolveInvoiceCompany(tenant, false, { enabled: "true", name: "Cash Services" }).bankAccountNo).toBeNull();
  });
  it("rejects an incomplete enabled profile instead of printing the GST company", () => {
    expect(() => resolveInvoiceCompany(tenant, false, { enabled: "true", name: "" })).toThrow("Complete the without-GST company profile");
  });
  it("uses the existing company while the separate profile is disabled", () => {
    expect(resolveInvoiceCompany(tenant, false, { ...profile, enabled: "false" })).toBe(tenant);
  });
  it("validates identity and bank fields before saving", () => {
    expect(nonGstCompanySchema.safeParse({ enabled: "true", name: "" }).success).toBe(false);
    expect(nonGstCompanySchema.safeParse({ ...profile, bankIfsc: "INVALID" }).success).toBe(false);
    expect(nonGstCompanySchema.safeParse({ ...profile, gstin: tenant.gstin }).success).toBe(false);
    expect(nonGstCompanySchema.parse({ ...profile, bankIfsc: "tmbl0000283" }).bankIfsc).toBe("TMBL0000283");
  });
});
