import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@fii/database";
import { badRequest, decryptSecret, customerMailRecipients, companyMailCc } from "@fii/common";
import { buildInvoicePdfBuffer } from "./pdf.service.js";
import { buildSalesDocumentPdfBuffer } from "@fii/pdf";

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

const transports = new Map<string, Transporter>();

async function smtpFor(tenantId: string): Promise<{ t: Transporter; from: string }> {
  const rows = await prisma.setting.findMany({ where: { tenantId, group: "SMTP" } });
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.isSecret ? decryptSecret(r.value) : r.value;
  if (cfg.enabled !== "true" || !cfg.host) {
    throw badRequest("SMTP is not configured — set it up in Settings → Email (SMTP)");
  }
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

/** Quotation/proforma sending is explicit; invoice notifications use the existing event flow. */
export async function emailSalesDocument(tenantId: string, id: string): Promise<{ to: string; cc?: string }> {
  const { buffer, document } = await buildSalesDocumentPdfBuffer(tenantId, id);
  if (document.status === "CANCELLED") throw badRequest("Cancelled documents cannot be emailed");
  const to = customerMailRecipients(document.customer);
  if (!to) throw badRequest("Add the customer's email address before sending this document");
  const title = document.kind === "QUOTATION" ? "Quotation" : "Proforma invoice";
  const subject = `${title} ${document.documentNumber}`;
  const body = `Dear ${document.customer.name},\n\nPlease find attached ${title.toLowerCase()} ${document.documentNumber} for INR ${Number(document.grandTotal).toFixed(2)}. This is not a tax invoice.\n\nThank you.`;
  const company=await prisma.tenant.findUniqueOrThrow({where:{id:tenantId},select:{email:true}});
  const cc=companyMailCc(company.email,to);
  const smtp = await smtpFor(tenantId);
  const row = await prisma.notificationLog.create({ data: { tenantId, channel: "EMAIL", to, subject, body, templateCode: "SALES_DOCUMENT_EMAIL", status: "QUEUED", refType: document.kind, refId: id } });
  try {
    await smtp.t.sendMail({ from: smtp.from, to, cc, subject, text: body, attachments: [{ filename: document.documentNumber.replace(/[\\/]/g, "-") + ".pdf", content: buffer, contentType: "application/pdf" }] });
    await prisma.notificationLog.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
    return { to, cc };
  } catch (error) {
    await prisma.notificationLog.update({ where: { id: row.id }, data: { status: "FAILED", error: String(error).slice(0, 500), attempts: { increment: 1 } } });
    throw badRequest("Email failed. Check SMTP settings and notification logs before retrying.");
  }
}

/** Emails the invoice PDF to the customer; logs to NotificationLog. */
export async function emailInvoice(tenantId: string, invoiceId: string): Promise<{ to: string; cc?: string }> {
  const { buffer, invoice } = await buildInvoicePdfBuffer(tenantId, invoiceId);
  const to = customerMailRecipients(invoice.customer);
  if (!to) throw badRequest("Customer has no email address — add one on the customer profile");

  const tpl = await prisma.notificationTemplate.findFirst({
    where: { tenantId, code: "INVOICE_GENERATED", channel: "EMAIL", isActive: true },
  });
  const vars = {
    customerName: invoice.customer.name,
    invoiceNumber: invoice.invoiceNumber,
    amount: Number(invoice.grandTotal).toFixed(2),
    dueDate: invoice.dueDate.toLocaleDateString("en-IN"),
  };
  const subject = tpl?.subject ? render(tpl.subject, vars) : `Invoice ${invoice.invoiceNumber}`;
  const body = tpl ? render(tpl.body, vars) : `Dear ${vars.customerName},\n\nPlease find attached invoice ${vars.invoiceNumber} for Rs. ${vars.amount}, due on ${vars.dueDate}.\n\nThank you.`;

  const company=await prisma.tenant.findUniqueOrThrow({where:{id:tenantId},select:{email:true}});
  const cc=companyMailCc(company.email,to);
  const logRow = await prisma.notificationLog.create({
    data: {
      tenantId, channel: "EMAIL", to, templateCode: "INVOICE_EMAIL_MANUAL",
      subject, body, status: "QUEUED", refType: "INVOICE", refId: invoice.id,
    },
  });

  try {
    const smtp = await smtpFor(tenantId);
    await smtp.t.sendMail({
      from: smtp.from,
      to,
      cc,
      subject,
      html: body.replace(/\n/g, "<br/>"),
      attachments: [{
        filename: `${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`,
        content: buffer,
        contentType: "application/pdf",
      }],
    });
    await prisma.notificationLog.update({
      where: { id: logRow.id },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
    });
    return { to, cc };
  } catch (err) {
    await prisma.notificationLog.update({
      where: { id: logRow.id },
      data: { status: "FAILED", error: String(err).slice(0, 500), attempts: { increment: 1 } },
    });
    throw badRequest(`Email failed: ${String(err).slice(0, 200)}`);
  }
}
