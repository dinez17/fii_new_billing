/**
 * notification-worker — turns domain events into customer notifications.
 *
 *   notification.send   → explicit {template, to, vars} (scheduler reminders …)
 *   invoice.created     → INVOICE_GENERATED
 *   payment.success     → PAYMENT_RECEIVED
 *   payment.failed      → PAYMENT_FAILED
 */
import { prisma } from "@fii/database";
import { createLogger, startOpsServer, customerMailRecipients } from "@fii/common";
import { TOPICS, runConsumer, type EventEnvelope } from "@fii/kafka";
import { buildInvoicePdfBuffer, buildReceiptPdfBuffer } from "@fii/pdf";
import { dispatch, retryNotifications } from "./send.js";

const log = createLogger("notification-worker");

async function customerContact(tenantId: string, customerId: string) {
  const c = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { name: true, email: true, additionalEmails: true, phone: true },
  });
  return c ? { ...c, billingEmail: customerMailRecipients(c) } : { name: "Customer", email: null, billingEmail: null, phone: null };
}

async function handle(topic: string, event: EventEnvelope): Promise<void> {
  const { tenantId } = event;

  switch (topic) {
    case TOPICS.NOTIFICATION_SEND: {
      const p = event.payload as {
        template: string;
        customerId?: string;
        to?: { email?: string | null; phone?: string | null };
        vars?: Record<string, string>;
      };
      let to = p.to;
      let vars = p.vars ?? {};
      if (p.customerId && !to) {
        const c = await customerContact(tenantId, p.customerId);
        to = { email: c.email, phone: c.phone };
        vars = { customerName: c.name, ...vars };
      }
      await dispatch({ tenantId, templateCode: p.template, to: to ?? {}, vars, refType: "CUSTOM", refId: p.customerId });
      break;
    }
    case TOPICS.INVOICE_CREATED: {
      const p = event.payload as { invoiceId: string; invoiceNumber: string; customerId: string; grandTotal: string; dueDate: string };
      const c = await customerContact(tenantId, p.customerId);
      let attachments: { filename: string; content: Buffer }[] | undefined;
      try {
        const { buffer } = await buildInvoicePdfBuffer(tenantId, p.invoiceId);
        attachments = [{ filename: `${p.invoiceNumber.replace(/\//g, "-")}.pdf`, content: buffer }];
      } catch (err) {
        log.warn({ err: String(err) }, "invoice PDF attach failed — sending without");
      }
      await dispatch({
        tenantId,
        templateCode: "INVOICE_GENERATED",
        to: { email: c.billingEmail, phone: c.phone },
        vars: {
          customerName: c.name,
          invoiceNumber: p.invoiceNumber,
          amount: Number(p.grandTotal).toFixed(2),
          dueDate: new Date(p.dueDate).toLocaleDateString("en-IN"),
        },
        refType: "INVOICE",
        refId: p.invoiceId,
        attachments,
      });
      break;
    }
    case TOPICS.PAYMENT_SUCCESS: {
      const p = event.payload as { paymentId: string; customerId: string; amount: string; receiptNumber: string };
      const payment = await prisma.payment.findFirst({ where: { tenantId, id: p.paymentId } });
      if (!payment || payment.status !== "SUCCESS") break;
      const c = await customerContact(tenantId, p.customerId);
      let attachments: { filename: string; content: Buffer }[] | undefined;
      try {
        const receipt = await prisma.receipt.findFirst({ where: { tenantId, paymentId: p.paymentId } });
        if (receipt) {
          const { buffer } = await buildReceiptPdfBuffer(tenantId, receipt.id);
          attachments = [{ filename: `${p.receiptNumber.replace(/\//g, "-")}.pdf`, content: buffer }];
        }
      } catch (err) {
        log.warn({ err: String(err) }, "receipt PDF attach failed — sending without");
      }
      await dispatch({
        tenantId,
        templateCode: "PAYMENT_RECEIVED",
        to: { email: c.billingEmail, phone: c.phone },
        vars: { customerName: c.name, amount: Number(p.amount).toFixed(2), receiptNumber: p.receiptNumber },
        refType: "PAYMENT",
        refId: p.paymentId,
        attachments,
      });
      break;
    }
    case TOPICS.PAYMENT_FAILED: {
      const p = event.payload as { paymentId: string; customerId: string; reason: string };
      const c = await customerContact(tenantId, p.customerId);
      await dispatch({
        tenantId,
        templateCode: "PAYMENT_FAILED",
        to: { email: c.email, phone: c.phone },
        vars: { customerName: c.name, reason: p.reason },
        refType: "PAYMENT",
        refId: p.paymentId,
      });
      break;
    }
    case TOPICS.COMPLAINT_CREATED: {
      const p = event.payload as { complaintId: string; complaintNumber: string; customerId: string; subject: string };
      const c = await customerContact(tenantId, p.customerId);
      await dispatch({
        tenantId,
        templateCode: "COMPLAINT_CREATED",
        to: { email: c.email, phone: c.phone },
        vars: { customerName: c.name, complaintNumber: p.complaintNumber, subject: p.subject },
        refType: "COMPLAINT",
        refId: p.complaintId,
      });
      break;
    }
    case TOPICS.COMPLAINT_ASSIGNED: {
      const p = event.payload as {
        complaintId: string; complaintNumber: string; customerId: string;
        employeeName?: string; employeeEmail?: string | null; subject: string;
      };
      // notify the technician
      if (p.employeeEmail) {
        await dispatch({
          tenantId,
          templateCode: "COMPLAINT_ASSIGNED",
          to: { email: p.employeeEmail },
          vars: { employeeName: p.employeeName ?? "", complaintNumber: p.complaintNumber, subject: p.subject },
          refType: "COMPLAINT",
          refId: p.complaintId,
        });
      }
      break;
    }
    case TOPICS.COMPLAINT_RESOLVED: {
      const p = event.payload as { complaintId: string; complaintNumber: string; customerId: string; subject: string; resolutionNotes: string };
      const c = await customerContact(tenantId, p.customerId);
      await dispatch({
        tenantId,
        templateCode: "COMPLAINT_RESOLVED",
        to: { email: c.email, phone: c.phone },
        vars: { customerName: c.name, complaintNumber: p.complaintNumber, subject: p.subject, resolutionNotes: p.resolutionNotes },
        refType: "COMPLAINT",
        refId: p.complaintId,
      });
      break;
    }
    case TOPICS.STOCK_UPDATED: {
      const p = event.payload as { productId: string; balance: number; reorderLevel: number; lowStock?: boolean };
      if (!p.lowStock) break;
      const [product, tenant] = await Promise.all([
        prisma.product.findFirst({ where: { id: p.productId, tenantId }, select: { name: true, sku: true } }),
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { email: true } }),
      ]);
      if (!product || !tenant?.email) break;
      await dispatch({
        tenantId,
        templateCode: "LOW_STOCK",
        to: { email: tenant.email },
        vars: {
          productName: product.name,
          sku: product.sku,
          balance: String(p.balance),
          reorderLevel: String(p.reorderLevel),
        },
        refType: "PRODUCT",
        refId: p.productId,
      });
      break;
    }
    default:
      log.debug({ topic }, "no notification mapping");
  }
}

async function main() {
  const stop = await runConsumer({
    groupId: "notification-worker",
    topics: [
      TOPICS.NOTIFICATION_SEND, TOPICS.INVOICE_CREATED, TOPICS.PAYMENT_SUCCESS, TOPICS.PAYMENT_FAILED,
      TOPICS.STOCK_UPDATED, TOPICS.COMPLAINT_CREATED, TOPICS.COMPLAINT_ASSIGNED, TOPICS.COMPLAINT_RESOLVED,
    ],
    handler: handle,
  });
  log.info("notification-worker consuming");
  let retrying = false;
  const timer = setInterval(() => {
    if (retrying) return;
    retrying = true;
    void retryNotifications().catch(err => log.error({ err: String(err) }, "Notification retry scan failed")).finally(() => { retrying = false; });
  }, 30000);
  timer.unref();
  const stopOps = startOpsServer({ name: "notification-worker", port: Number(process.env.NOTIFICATION_WORKER_OPS_PORT ?? 9103), checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });
  process.on("SIGINT", async () => { clearInterval(timer); stopOps(); await stop(); process.exit(0); });
  process.on("SIGTERM", async () => { clearInterval(timer); stopOps(); await stop(); process.exit(0); });
}

main().catch((err) => { log.error({ err: String(err) }, "fatal"); process.exit(1); });
