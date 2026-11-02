import {prisma,queueReceiptNotification} from "@fii/database";
import {badRequest,notFound,customerMailRecipients,normalizeWhatsappPhone} from "@fii/common";
export async function sendReceipt(tenantId:string,actorId:string,receiptId:string,channel:"EMAIL"|"WHATSAPP",requestId:string){
 const receipt=await prisma.receipt.findFirst({where:{id:receiptId,tenantId},include:{payment:{include:{customer:true}}}});
 if(!receipt||receipt.payment.tenantId!==tenantId||receipt.payment.customer.tenantId!==tenantId)throw notFound("Receipt");
 if(receipt.payment.status!=="SUCCESS")throw badRequest("Reversed or unsuccessful receipts cannot be sent");
 const customer=receipt.payment.customer;
 const company=channel==="EMAIL"?await prisma.tenant.findUniqueOrThrow({where:{id:tenantId},select:{email:true}}):null;
 let to=customerMailRecipients(customer,company?.email);
 if(channel==="WHATSAPP"){
  if(!customer.whatsappInvoiceEnabled)throw badRequest("Enable WhatsApp delivery on this customer first");
  const phone=normalizeWhatsappPhone(customer.whatsappPhone||customer.phone);to=phone?"+"+phone:"";
 }
 if(!to)throw badRequest(channel==="EMAIL"?"Set the customer email or tenant company email before sending the receipt":"Set a valid customer WhatsApp number");
 const group=channel==="EMAIL"?"SMTP":"WHATSAPP";
 const settings=await prisma.setting.findMany({where:{tenantId,group}});
 if(!settings.some(s=>s.key==="enabled"&&s.value==="true") || (channel==="EMAIL"?!settings.some(s=>s.key==="host"&&s.value):!settings.some(s=>s.key==="apiKey"&&s.isSecret&&s.value)))throw badRequest(`Configure ${group} in Settings first`);
 const row=await queueReceiptNotification(tenantId,receiptId,{channel,to,requestId,actorId});
 return {queued:row.status==="QUEUED",status:row.status,notificationId:row.id};
}
