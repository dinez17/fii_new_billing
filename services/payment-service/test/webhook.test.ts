import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, verifyCheckoutSignature } from "../src/services/razorpay.js";

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

describe("Razorpay signature verification (webhook replay protection)", () => {
  const secret = "whsec_test_123";

  it("accepts a correctly signed webhook body", () => {
    const raw = Buffer.from(JSON.stringify({ event: "payment.captured", id: "pay_1" }));
    expect(verifyWebhookSignature(secret, raw, sign(secret, raw.toString()))).toBe(true);
  });

  it("rejects a tampered body (same signature, different payload)", () => {
    const raw = Buffer.from(JSON.stringify({ event: "payment.captured", amount: 100 }));
    const goodSig = sign(secret, raw.toString());
    const tampered = Buffer.from(JSON.stringify({ event: "payment.captured", amount: 999999 }));
    expect(verifyWebhookSignature(secret, tampered, goodSig)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const raw = Buffer.from("{}");
    expect(verifyWebhookSignature(secret, raw, sign("attacker", raw.toString()))).toBe(false);
  });

  it("verifies the checkout order|payment signature", () => {
    const cfg = { keyId: "rzp_test_k", keySecret: "sk_test" };
    const good = createHmac("sha256", cfg.keySecret).update("order_1|pay_1").digest("hex");
    expect(verifyCheckoutSignature(cfg, "order_1", "pay_1", good)).toBe(true);
    expect(verifyCheckoutSignature(cfg, "order_1", "pay_1", "deadbeef")).toBe(false);
  });
});
