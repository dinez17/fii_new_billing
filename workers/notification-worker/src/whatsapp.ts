import {prisma} from "@fii/database";
import {buildInvoicePdfBuffer} from "@fii/pdf";
import {decryptSecret,normalizeWhatsappPhone,wapiClient,WapiError} from "@fii/common";
type Client=ReturnType<typeof wapiClient>;
export async function deliverWhatsappNotification(id:string,clientFactory:(config:{apiKey:string;deviceId?:number;apiUrl?:string})=>Client=wapiClient){
 const now=new Date();
 const claimed=await prisma.notificationLog.updateMany({where:{id,channel:"WHATSAPP",status:{in:["QUEUED","FAILED"]},requiresReview:false,AND:[{OR:[{lockedUntil:null},{lockedUntil:{lt:now}}]},{OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}]}]},data:{lockedUntil:new Date(now.getTime()+120000)}});
 if(!claimed.count)return;
 const row=await prisma.notificationLog.findUniqueOrThrow({where:{id}});
 try{
  if(row.refType!=="INVOICE"||!row.refId)throw new WapiError("WhatsApp delivery is enabled for invoice PDFs only");
  const invoice=await prisma.invoice.findFirst({where:{tenantId:row.tenantId,id:row.refId,status:{notIn:["DRAFT","CANCELLED"]}},include:{customer:true}});
  if(!invoice||invoice.customer.tenantId!==row.tenantId||!invoice.customer.whatsappInvoiceEnabled)throw new WapiError("Invoice unavailable or customer WhatsApp delivery is disabled");
  const destination=normalizeWhatsappPhone(invoice.customer.whatsappPhone||invoice.customer.phone);
  if(!destination||"+"+destination!==row.to)throw new WapiError("Customer WhatsApp number changed; use the invoice's WhatsApp action to queue the current destination");
  const settings=await prisma.setting.findMany({where:{tenantId:row.tenantId,group:"WHATSAPP"}}),cfg=Object.fromEntries(settings.map(s=>[s.key,s.isSecret?decryptSecret(s.value):s.value]));
  if(cfg.enabled!=="true"||cfg.provider!=="FII_WAPI"||!cfg.apiKey)throw new WapiError("Configure and enable WAPI in Settings → WhatsApp");
  const client=clientFactory({apiUrl:cfg.apiUrl,apiKey:cfg.apiKey,deviceId:cfg.deviceId?Number(cfg.deviceId):undefined});
  let result;
  if(row.providerMessageId){
   if(row.providerPolls>=30)throw new WapiError("WAPI confirmation timed out; review provider history before resending",true);
   await prisma.notificationLog.update({where:{id},data:{providerPolls:{increment:1}}});
   result=await client.messageStatus(row.providerMessageId);
  }else{
   const pdf=await buildInvoicePdfBuffer(row.tenantId,invoice.id);
   // Persist uncertain state before the non-idempotent POST. A crash cannot silently resend it.
   await prisma.notificationLog.update({where:{id},data:{requiresReview:true,providerStatus:"SUBMITTING",attempts:{increment:1}}});
   result=await client.sendDocument({to:row.to,pdf:pdf.buffer,fileName:invoice.invoiceNumber.replace(/[\\/]/g,"-")+".pdf",caption:`Invoice ${invoice.invoiceNumber} · INR ${invoice.grandTotal.toFixed(2)}`});
  }
  if(result.status==="FAILED") { await prisma.notificationLog.update({where:{id},data:{providerMessageId:result.messageId,providerStatus:result.providerStatus}}); throw new WapiError("WAPI reports this document was not sent; check provider history before retrying"); }
  await prisma.notificationLog.update({where:{id},data:{providerMessageId:result.messageId??row.providerMessageId,providerStatus:result.providerStatus,requiresReview:false,lockedUntil:null,error:null,status:result.status==="SENT"?"SENT":"QUEUED",sentAt:result.status==="SENT"?new Date():null,nextAttemptAt:result.status==="PENDING"?new Date(Date.now()+30000):null}});
 }catch(error){
  const polling=!!row.providerMessageId&&row.providerPolls<29&&error instanceof WapiError&&!error.uncertain&&error.message.includes("status service");
  await prisma.notificationLog.update({where:{id},data:{status:polling?"QUEUED":"FAILED",lockedUntil:null,requiresReview:!polling,error:error instanceof WapiError?error.message:"WhatsApp invoice delivery failed; review provider status before retrying",providerStatus:polling?"AWAITING_STATUS":error instanceof WapiError&&error.uncertain?"UNKNOWN":"REVIEW",nextAttemptAt:polling?new Date(Date.now()+60000):null}});
 }
}
