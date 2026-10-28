import { describe, expect, it } from "vitest";
import { licenseSummary } from "../src/license.service.js";
const now = new Date("2026-10-27T12:00:00Z");
const base = { isActive: true, licenseStatus: "ACTIVE", licenseEndsAt: null, trialEndsAt: null };
describe("tenant license status", () => {
  it("uses trial expiry for trials and license expiry for active plans", () => {
    expect(licenseSummary({ ...base, licenseStatus: "TRIAL", trialEndsAt: new Date("2026-10-28T12:00:00Z"), licenseEndsAt: new Date("2026-01-01") }, now)).toMatchObject({ effectiveStatus: "TRIAL", daysRemaining: 1 });
    expect(licenseSummary({ ...base, licenseEndsAt: new Date("2026-10-26") }, now)).toMatchObject({ effectiveStatus: "EXPIRED", daysRemaining: 0 });
  });
  it("does not label missing expiry dates as expired", () => {
    expect(licenseSummary(base, now)).toEqual({ effectiveStatus: "ACTIVE", validUntil: null, daysRemaining: null });
  });
  it("preserves suspension/cancellation and handles disabled tenants", () => {
    expect(licenseSummary({ ...base, isActive: false }, now).effectiveStatus).toBe("SUSPENDED");
    expect(licenseSummary({ ...base, licenseStatus: "CANCELLED", licenseEndsAt: new Date("2025-01-01") }, now).effectiveStatus).toBe("CANCELLED");
  });
});
