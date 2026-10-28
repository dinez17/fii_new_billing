import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "../src/crypto.js";

beforeAll(() => {
  // 64 hex chars = 32 bytes (test key only)
  process.env.MASTER_ENCRYPTION_KEY = "0".repeat(64);
});

describe("AES-256-GCM secret crypto", () => {
  it("round-trips a secret", () => {
    const plain = "rzp_live_abcd1234efgh";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);
    expect(enc.split(":").length).toBe(3);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a fresh IV each time (ciphertext differs)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails to decrypt a tampered payload", () => {
    const enc = encryptSecret("token");
    const [iv, tag, data] = enc.split(":");
    const tampered = [iv, tag, Buffer.from("evil").toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("masks all but the first and last four characters", () => {
    expect(maskSecret("rzp_live_abcd1234efgh")).toBe("rzp_****efgh");
    expect(maskSecret("short")).toBe("****");
  });
});
