import {Prisma} from "@prisma/client";
import {prisma} from "./client.js";
export class WhatsappQueueError extends Error {}
/** One automatic WhatsApp job per invoice; explicit sends use a caller request ID. */
export async function queueInvoiceWhatsapp(tenantId:string,invoiceId:string,input:{to:string;requestId?:string;actorId?:string}){
 if(!/^\+[1-9]\d{7,14}$/.test(input.to))throw new WhatsappQueueError("Set a valid WhatsApp number on the customer");
 return prisma.$transaction(async(tx:Prisma.TransactionClient)=>{
  const invoice=await tx.invoice.findFirst({where:{tenantId,id:invoiceId},include:{customer:true}});
  if(!invoice||invoice.customer.tenantId!==tenantId)throw new WhatsappQueueError("Invoice not found");
  if(["DRAFT","CANCELLED"].includes(invoice.status))throw new WhatsappQueueError("Draft or cancelled invoices cannot be sent");
  if(!invoice.customer.whatsappInvoiceEnabled)throw new WhatsappQueueError("Enable WhatsApp invoice delivery for this customer first");
  const dedupeKey="WHATSAPP:INVOICE:"+invoice.id+":"+(input.requestId??"AUTO");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+":"+dedupeKey},0))`;
  const existing=await tx.notificationLog.findUnique({where:{tenantId_dedupeKey:{tenantId,dedupeKey}}});if(existing)return existing;
  const row=await tx.notificationLog.create({data:{tenantId,channel:"WHATSAPP",to:input.to,dedupeKey,templateCode:input.requestId?"INVOICE_WHATSAPP_MANUAL":"INVOICE_WHATSAPP_AUTO",subject:"Invoice "+invoice.invoiceNumber,body:`Dear ${invoice.customer.name}, please find invoice ${invoice.invoiceNumber} for INR ${invoice.grandTotal.toFixed(2)} attached.`,refType:"INVOICE",refId:invoice.id,status:"QUEUED",nextAttemptAt:new Date()}});
  await tx.auditLog.create({data:{tenantId,userId:input.actorId,action:"INVOICE_WHATSAPP_QUEUED",entity:"Invoice",entityId:invoice.id,after:{notificationId:row.id,automatic:!input.requestId}}});
  return row;
 });
}

/** Receipt emails and WhatsApp PDFs share durable delivery logs and request deduplication. */
export async function queueReceiptNotification(tenantId:string,receiptId:string,input:{channel:"EMAIL"|"WHATSAPP";to:string;requestId?:string;actorId?:string}){
 if(!input.to || /[\r\n]/.test(input.to))throw new WhatsappQueueError("Set a valid customer destination");
 if(input.channel==="WHATSAPP"&&!/^\+[1-9]\d{7,14}$/.test(input.to))throw new WhatsappQueueError("Set a valid WhatsApp number on the customer");
 return prisma.$transaction(async(tx:Prisma.TransactionClient)=>{
  const receipt=await tx.receipt.findFirst({where:{tenantId,id:receiptId},include:{payment:{include:{customer:true}}}});
  if(!receipt||receipt.payment.tenantId!==tenantId||receipt.payment.customer.tenantId!==tenantId)throw new WhatsappQueueError("Receipt not found");
  if(receipt.payment.status!=="SUCCESS")throw new WhatsappQueueError("Only successful payment receipts can be sent");
  if(input.channel==="WHATSAPP"&&!receipt.payment.customer.whatsappInvoiceEnabled)throw new WhatsappQueueError("Enable WhatsApp delivery for this customer first");
  const dedupeKey=input.channel+":RECEIPT:"+receipt.id+":"+(input.requestId??"AUTO");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+":"+dedupeKey},0))`;
  const existing=await tx.notificationLog.findUnique({where:{tenantId_dedupeKey:{tenantId,dedupeKey}}});if(existing)return existing;
  const row=await tx.notificationLog.create({data:{tenantId,channel:input.channel,to:input.to,dedupeKey,templateCode:"RECEIPT_"+input.channel+(input.requestId?"_MANUAL":"_AUTO"),subject:"Receipt "+receipt.receiptNumber,body:`Dear ${receipt.payment.customer.name}, please find payment receipt ${receipt.receiptNumber} for INR ${receipt.payment.amount.toFixed(2)} attached. Thank you.`,refType:input.channel==="EMAIL"?"PAYMENT":"RECEIPT",refId:input.channel==="EMAIL"?receipt.paymentId:receipt.id,status:"QUEUED",nextAttemptAt:new Date()}});
  await tx.auditLog.create({data:{tenantId,userId:input.actorId,action:"RECEIPT_DELIVERY_QUEUED",entity:"Receipt",entityId:receipt.id,after:{notificationId:row.id,channel:input.channel,automatic:!input.requestId}}});return row;
 });
}
