import nodemailer, { type Transporter, type SendMailOptions } from "nodemailer";
import { buildInvoicePdfBuffer, buildReceiptPdfBuffer } from "@fii/pdf";
import { prisma } from "@fii/database";
import { createLogger, decryptSecret, companyMailCc } from "@fii/common";

const log = createLogger("notification-worker");

/** {{var}} substitution — deliberately tiny, no logic in templates. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

async function groupSettings(tenantId: string, group: string): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { tenantId, group } });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.isSecret ? decryptSecret(r.value) : r.value;
  return out;
}

// per-tenant SMTP transport cache (rebuilt if settings change → worker restart)
const transports = new Map<string, Transporter>();

async function getTransport(tenantId: string): Promise<{ t: Transporter; from: string } | null> {
  const cfg = await groupSettings(tenantId, "SMTP");
  if (cfg.enabled !== "true" || !cfg.host) return null;
  const key = JSON.stringify([tenantId, cfg.host, cfg.port, cfg.user, cfg.password]);
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host: cfg.host,
      port: Number(cfg.port ?? 587),
      secure: Number(cfg.port) === 465,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    });
    for (const old of transports.keys()) if (JSON.parse(old)[0] === tenantId) { transports.get(old)?.close(); transports.delete(old); }
    transports.set(key, t);
  }
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail ?? cfg.user}>` : (cfg.fromEmail ?? cfg.user);
  return { t, from };
}

export interface SendRequest {
  tenantId: string;
  templateCode: string;
  to: { email?: string | null; phone?: string | null };
  vars: Record<string, string>;
  refType?: string;
  refId?: string;
  /** EMAIL channel only — PDF attachments (invoice, receipt …) */
  attachments?: { filename: string; content: Buffer }[];
}

/**
 * Sends across every channel that has (a) an active template for the code and
 * (b) a configured provider and (c) a recipient address. Each attempt is
 * recorded in NotificationLog.
 */
export async function dispatch(req: SendRequest): Promise<void> {
  const templates = await prisma.notificationTemplate.findMany({
    where: { tenantId: req.tenantId, code: req.templateCode, isActive: true },
  });
  if (templates.length === 0) {
    log.debug({ code: req.templateCode }, "no active template — skipping");
    return;
  }

  for (const tpl of templates) {
    const body = render(tpl.body, req.vars);
    const subject = tpl.subject ? render(tpl.subject, req.vars) : undefined;

    const to =
      tpl.channel === "EMAIL" ? req.to.email :
      req.to.phone; // SMS + WHATSAPP
    if (!to) continue;

    const logRow = await prisma.notificationLog.create({
      data: {
        tenantId: req.tenantId,
        channel: tpl.channel,
        to,
        templateCode: req.templateCode,
        subject,
        body,
        status: "QUEUED",
        nextAttemptAt: new Date(),
        refType: req.refType,
        refId: req.refId,
      },
    });

    await deliverNotification(logRow.id, req.attachments);
  }
}

/** Lease each channel separately; a failed channel never resends another channel. */
export async function deliverNotification(id: string, suppliedAttachments?: SendRequest["attachments"], sender?: (mail: SendMailOptions) => Promise<unknown>) {
  const now = new Date();
  const claimed = await prisma.notificationLog.updateMany({ where: { id, status: { in: ["QUEUED", "FAILED"] }, attempts: { lt: 5 },
    AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }] },
    data: { lockedUntil: new Date(now.getTime() + 120000), attempts: { increment: 1 } } });
  if (!claimed.count) return;
  const row = await prisma.notificationLog.findUniqueOrThrow({ where: { id } });
  try {
    if (row.channel !== "EMAIL") throw new Error(`${row.channel} delivery provider is not configured; no message was delivered`);
    let attachments = suppliedAttachments;
    if (row.refType === "INVOICE" && row.refId) {
      const invoice = await prisma.invoice.findFirst({ where: { id: row.refId, tenantId: row.tenantId, status: { notIn: ["CANCELLED", "DRAFT"] } } });
      if (!invoice) throw new Error("Invoice cancelled or unavailable; message not sent");
      if (!attachments?.length) {
        const pdf = await buildInvoicePdfBuffer(row.tenantId, row.refId);
        attachments = [{ filename: `${invoice.invoiceNumber.replaceAll("/", "-")}.pdf`, content: pdf.buffer }];
      }
    }
    if (row.refType === "PAYMENT" && row.refId) {
      const payment = await prisma.payment.findFirst({ where: { id: row.refId, tenantId: row.tenantId, status: "SUCCESS" }, include: { receipt: true } });
      if (!payment?.receipt) throw new Error("Receipt reversed or unavailable; message not sent");
      if (!attachments?.length) {
        const pdf = await buildReceiptPdfBuffer(row.tenantId, payment.receipt.id);
        attachments = [{ filename: `${payment.receipt.receiptNumber.replaceAll("/", "-")}.pdf`, content: pdf.buffer }];
      }
    }
    const smtp = sender ? { from: "test@example.test", t: { sendMail: sender } } : await getTransport(row.tenantId);
    if (!smtp) throw new Error("SMTP not configured/enabled");
    const body = (row.body ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br/>");
    const company=await prisma.tenant.findUniqueOrThrow({where:{id:row.tenantId},select:{email:true}});
    const cc=companyMailCc(company.email,row.to);
    await smtp.t.sendMail({ from: smtp.from, to: row.to, cc, subject: row.subject ?? row.templateCode ?? "Notification",
      messageId: `<${row.id}@notifications.fii-vaniga.local>`, html: body,
      attachments: attachments?.map(a => ({ ...a, contentType: "application/pdf" })) });
    await prisma.notificationLog.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), error: null, lockedUntil: null, nextAttemptAt: null } });
  } catch (error) {
    await prisma.notificationLog.update({ where: { id }, data: { status: "FAILED", error: String(error).slice(0,500), lockedUntil: null,
      nextAttemptAt: row.attempts < 5 ? new Date(Date.now() + 60000 * 2 ** (row.attempts - 1)) : null } });
    log.warn({ id, attempt: row.attempts }, "Notification failed; see tenant send log");
  }
}

export async function retryNotifications(sender?: (mail: SendMailOptions) => Promise<unknown>) {
  const now = new Date();
  await prisma.notificationLog.updateMany({ where: { channel: "EMAIL", status: "QUEUED", attempts: { gte: 5 }, lockedUntil: { lt: now } },
    data: { status: "FAILED", lockedUntil: null, nextAttemptAt: null, error: "Final delivery attempt was interrupted; verify provider delivery before manually retrying" } });
  const rows = await prisma.notificationLog.findMany({ where: { channel: "EMAIL", attempts: { lt: 5 },
    OR: [{ status: "QUEUED", nextAttemptAt: { lte: now } }, { status: "FAILED", nextAttemptAt: { lte: now } }],
    AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }] }, orderBy: { createdAt: "asc" }, take: 20, select: { id: true } });
  for (const row of rows) await deliverNotification(row.id, undefined, sender);
}
