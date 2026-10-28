import { Router, raw } from "express";
import { z } from "zod";
import { prisma } from "@fii/database";
import { authenticate, requireCustomer } from "@fii/auth";
import { unauthorized } from "@fii/common";
import { h, log, parse } from "../http.js";
import {
  captureGatewayPayment, createGatewayOrder, failGatewayPayment,
  loadRazorpayConfig, verifyCheckoutSignature, verifyWebhookSignature,
} from "../services/razorpay.js";
import { streamReceiptPdf } from "../services/receipt-pdf.js";

const payBody = z.object({ invoiceIds: z.array(z.string().uuid()).max(50).default([]) });
const verifyBody = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

// ── Customer portal routes (JWT userType=CUSTOMER; own data only)
export const portalRouter = Router();
portalRouter.use(authenticate, requireCustomer);

portalRouter.post("/pay", h(async (req, res) => {
  const b = parse(payBody, req.body);
  res.json(await createGatewayOrder(req.auth!.tenantId, req.auth!.customerId!, b.invoiceIds));
}));

/** Called by the browser after Razorpay Checkout succeeds. */
portalRouter.post("/pay/verify", h(async (req, res) => {
  const b = parse(verifyBody, req.body);
  const cfg = await loadRazorpayConfig(req.auth!.tenantId);
  if (!verifyCheckoutSignature(cfg, b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
    throw unauthorized("Invalid payment signature");
  }
  res.json(await captureGatewayPayment(req.auth!.tenantId, b.razorpay_order_id, b.razorpay_payment_id, true));
}));

portalRouter.get("/payments", h(async (req, res) => {
  const items = await prisma.payment.findMany({
    where: { tenantId: req.auth!.tenantId, customerId: req.auth!.customerId! },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      receipt: { select: { id: true, receiptNumber: true } },
      allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
    },
  });
  res.json({ items });
}));

portalRouter.get("/receipts/:id/pdf", h(async (req, res) => {
  // ownDataGuard: verify the receipt belongs to this customer
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId, payment: { customerId: req.auth!.customerId! } },
  });
  if (!receipt) throw unauthorized("Not your receipt");
  await streamReceiptPdf(req.auth!.tenantId, receipt.id, res, (r) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${r.receiptNumber.replace(/\//g, "-")}.pdf"`);
  });
}));

// ── Razorpay webhook (public; raw body needed for signature verification)
export const webhookRouter = Router();

webhookRouter.post("/razorpay", raw({ type: "*/*" }), h(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const eventId = (req.headers["x-razorpay-event-id"] as string | undefined) ?? `no-id-${Date.now()}`;
  const rawBody = req.body as Buffer;

  let payload: {
    event: string;
    payload?: { payment?: { entity?: { order_id?: string; id?: string; notes?: { tenantId?: string }; error_description?: string } } };
  };
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "bad json" });
    return;
  }

  const entity = payload.payload?.payment?.entity;
  const tenantId = entity?.notes?.tenantId;
  if (!tenantId || !entity?.order_id) { res.json({ ok: true, skipped: true }); return; }

  // signature check
  let signatureOk = false;
  try {
    const cfg = await loadRazorpayConfig(tenantId);
    if (cfg.webhookSecret && signature) {
      signatureOk = verifyWebhookSignature(cfg.webhookSecret, rawBody, signature);
    }
  } catch { /* unconfigured */ }
  if (!signatureOk) {
    log.warn({ eventId }, "webhook signature failed — rejecting");
    res.status(401).json({ error: "bad signature" });
    return;
  }

  // idempotency: one row per (gateway, eventId)
  try {
    await prisma.webhookEvent.create({
      data: { gateway: "RAZORPAY", eventId, eventType: payload.event, payload: JSON.parse(rawBody.toString("utf8")), signatureOk },
    });
  } catch {
    res.json({ ok: true, duplicate: true }); // already processed
    return;
  }

  try {
    if (payload.event === "payment.captured") {
      await captureGatewayPayment(tenantId, entity.order_id, entity.id ?? "", true);
    } else if (payload.event === "payment.failed") {
      await failGatewayPayment(tenantId, entity.order_id, entity.error_description ?? "payment failed");
    }
    await prisma.webhookEvent.update({
      where: { gateway_eventId: { gateway: "RAZORPAY", eventId } },
      data: { processedAt: new Date() },
    });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { gateway_eventId: { gateway: "RAZORPAY", eventId } },
      data: { error: String(err).slice(0, 500) },
    });
    throw err;
  }

  res.json({ ok: true });
}));
