import { createHmac } from "node:crypto";
import { Prisma, prisma } from "@fii/database";
import { badRequest, decryptSecret } from "@fii/common";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";
import { autoAllocations, settleWithinTx } from "./settle.js";

export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret?: string }

export async function loadRazorpayConfig(tenantId: string): Promise<RazorpayConfig> {
  const rows = await prisma.setting.findMany({ where: { tenantId, group: "GATEWAY_RAZORPAY" } });
  const map = new Map(rows.map((r) => [r.key, r]));
  const keyId = map.get("keyId")?.value;
  const secretRow = map.get("keySecret");
  if (!keyId || !secretRow?.value) {
    throw badRequest("Razorpay is not configured — add keys in Settings → Payment gateway");
  }
  const webhookRow = map.get("webhookSecret");
  return {
    keyId,
    keySecret: secretRow.isSecret ? decryptSecret(secretRow.value) : secretRow.value,
    webhookSecret: webhookRow?.value
      ? (webhookRow.isSecret ? decryptSecret(webhookRow.value) : webhookRow.value)
      : undefined,
  };
}

/** Creates a payment order: Razorpay order + local Payment row (INITIATED). */
export async function createGatewayOrder(
  tenantId: string,
  customerId: string,
  invoiceIds: string[],
  actorId?: string,
) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (!fy) throw badRequest("No active financial year");

  // charge the full ledger outstanding: open invoices + opening balance /
  // on-account dues. Invoices are settled first; remainder stays on account.
  const [customer, sums] = await Promise.all([
    prisma.customer.findFirst({ where: { id: customerId, tenantId } }),
    prisma.ledgerEntry.aggregate({
      where: { tenantId, partyType: "CUSTOMER", partyId: customerId },
      _sum: { debit: true, credit: true },
    }),
  ]);
  if (!customer) throw badRequest("Customer not found");
  const amount =
    Number(customer.openingBalance) + Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0);
  if (amount <= 0) throw badRequest("Nothing to pay");

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, tenantId, customerId, status: { in: ["UNPAID", "PARTIAL"] } },
  });

  const cfg = await loadRazorpayConfig(tenantId);
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      notes: { tenantId, customerId },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw badRequest(`Razorpay order failed: ${text.slice(0, 300)}`);
  }
  const order = (await resp.json()) as { id: string; amount: number; currency: string };

  const payment = await prisma.payment.create({
    data: {
      tenantId,
      customerId,
      fyCode: fy.code,
      amount: new Prisma.Decimal(amount.toFixed(2)),
      mode: "GATEWAY",
      gateway: "RAZORPAY",
      status: "INITIATED",
      gatewayOrderId: order.id,
      notes: JSON.stringify({ invoiceIds: invoices.map((i) => i.id) }),
      createdById: actorId,
    },
  });

  await prisma.outboxEvent.create({
    data: {
      tenantId,
      topic: TOPICS.PAYMENT_INITIATED,
      eventKey: tenantId,
      payload: makeEnvelope(tenantId, { paymentId: payment.id, orderId: order.id, amount: amount.toFixed(2) }) as unknown as Prisma.InputJsonValue,
    },
  });

  return { paymentId: payment.id, orderId: order.id, amount: order.amount, currency: order.currency, keyId: cfg.keyId };
}

export function verifyCheckoutSignature(cfg: RazorpayConfig, orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac("sha256", cfg.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return expected === signature;
}

export function verifyWebhookSignature(webhookSecret: string, rawBody: Buffer, signature: string): boolean {
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return expected === signature;
}

/**
 * Marks a gateway payment captured and settles it (idempotent — a second
 * call for the same order is a no-op because status is no longer INITIATED).
 */
export async function captureGatewayPayment(
  tenantId: string,
  gatewayOrderId: string,
  gatewayPaymentId: string,
  signatureOk: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { tenantId, gatewayOrderId } });
    if (!payment) throw badRequest(`No payment for order ${gatewayOrderId}`);
    if (payment.status !== "INITIATED") return { alreadyProcessed: true, paymentId: payment.id };

    const meta = JSON.parse(payment.notes ?? "{}") as { invoiceIds?: string[] };
    const allocations = await autoAllocations(tx, tenantId, payment.customerId, Number(payment.amount), meta.invoiceIds);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        gatewayPaymentId,
        gatewaySignatureOk: signatureOk,
        paymentDate: new Date(),
      },
    });

    const receipt = await settleWithinTx(tx, {
      tenantId,
      paymentId: payment.id,
      customerId: payment.customerId,
      amount: Number(payment.amount),
      mode: "GATEWAY",
      paymentDate: new Date(),
      fyCode: payment.fyCode,
      allocations,
    });

    return { alreadyProcessed: false, paymentId: payment.id, receiptId: receipt.id, receiptNumber: receipt.receiptNumber };
  });
}

export async function failGatewayPayment(tenantId: string, gatewayOrderId: string, reason: string) {
  const payment = await prisma.payment.findFirst({ where: { tenantId, gatewayOrderId } });
  if (!payment || payment.status !== "INITIATED") return;
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: reason.slice(0, 300) } });
    await writeOutbox(tx, tenantId, TOPICS.PAYMENT_FAILED, makeEnvelope(tenantId, {
      paymentId: payment.id, customerId: payment.customerId, reason: reason.slice(0, 300),
    }));
  });
}
