import { describe, expect, it } from "vitest";
import { assertConsoleSession, parseConsoleScope, refreshCookieName } from "../src/services/console-session.js";
describe("console session isolation", () => {
  const platform = { id: "platform-user", userType: "STAFF", isPlatformAdmin: true };
  const tenant = { id: "tenant-user", userType: "STAFF", isPlatformAdmin: false };
  it("keeps tenant, platform and legacy/portal cookies separate", () => {
    expect(new Set([refreshCookieName(), refreshCookieName("tenant"), refreshCookieName("platform")]).size).toBe(3);
  });
  it("rejects invalid scope headers", () => { expect(() => parseConsoleScope("other")).toThrow("Invalid console scope"); expect(parseConsoleScope(undefined)).toBeUndefined(); });
  it("allows only the correct staff console", () => {
    expect(() => assertConsoleSession(platform, "platform")).not.toThrow();
    expect(() => assertConsoleSession(tenant, "tenant")).not.toThrow();
    expect(() => assertConsoleSession(tenant, "platform")).toThrow("correct platform");
    expect(() => assertConsoleSession(platform, "tenant")).toThrow("correct tenant");
    expect(() => assertConsoleSession({ ...tenant, userType: "CUSTOMER" }, "tenant")).toThrow("correct tenant");
  });
  it("rejects switching users during refresh even in the same console", () => {
    expect(() => assertConsoleSession(tenant, "tenant", "other-user")).toThrow("Account session changed");
    expect(() => assertConsoleSession(tenant, "tenant", tenant.id)).not.toThrow();
  });
});
