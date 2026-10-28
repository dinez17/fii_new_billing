import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@fii/database";
import { createLogger, decryptSecret } from "@fii/common";

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
  const key = `${tenantId}:${cfg.host}:${cfg.user}`;
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host: cfg.host,
      port: Number(cfg.port ?? 587),
      secure: Number(cfg.port) === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    });
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
        refType: req.refType,
        refId: req.refId,
      },
    });

    try {
      if (tpl.channel === "EMAIL") {
        const smtp = await getTransport(req.tenantId);
        if (!smtp) throw new Error("SMTP not configured/enabled");
        await smtp.t.sendMail({
          from: smtp.from,
          to,
          subject: subject ?? req.templateCode,
          html: body.replace(/\n/g, "<br/>"),
          attachments: req.attachments?.map((a) => ({ ...a, contentType: "application/pdf" })),
        });
      } else {
        // SMS / WhatsApp: providers plug in here. CONSOLE provider = dev mode.
        const group = tpl.channel === "SMS" ? "SMS" : "WHATSAPP";
        const cfg = await groupSettings(req.tenantId, group);
        if (cfg.enabled !== "true") throw new Error(`${group} not enabled`);
        if ((cfg.provider ?? "CONSOLE").toUpperCase() === "CONSOLE") {
          log.info({ channel: tpl.channel, to, body }, "CONSOLE provider — message logged only");
        } else {
          throw new Error(`${group} provider "${cfg.provider}" not implemented yet`);
        }
      }
      await prisma.notificationLog.update({
        where: { id: logRow.id },
        data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
      });
    } catch (err) {
      await prisma.notificationLog.update({
        where: { id: logRow.id },
        data: { status: "FAILED", error: String(err).slice(0, 500), attempts: { increment: 1 } },
      });
      log.warn({ channel: tpl.channel, to, err: String(err) }, "send failed");
      // do NOT rethrow — one failed channel shouldn't re-deliver the whole event
    }
  }
}
