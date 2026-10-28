import { beforeAll, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { encryptSecret } from "@fii/common";
import { verifyMfaCode } from "../src/services/account-security.service.js";

describe("TOTP MFA", () => {
  beforeAll(() => { process.env.MASTER_ENCRYPTION_KEY = "1".repeat(64); });

  it("accepts a current authenticator code", () => {
    const secret = authenticator.generateSecret();
    expect(() => verifyMfaCode(encryptSecret(secret), authenticator.generate(secret))).not.toThrow();
  });

  it("requires a code and rejects an invalid one", () => {
    const secret = encryptSecret(authenticator.generateSecret());
    expect(() => verifyMfaCode(secret)).toThrow(/required/i);
    expect(() => verifyMfaCode(secret, "000000")).toThrow(/invalid/i);
  });
});
