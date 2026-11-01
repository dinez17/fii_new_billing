import PDFDocument from "pdfkit";
import {prisma,loadBusinessDocument,BusinessDocumentError,type BusinessDocumentKind} from "@fii/database";
import {badRequest,customerMailRecipients,normalizeWhatsappPhone} from "@fii/common";
import {buildSalesDocumentPdfBuffer} from "./sales-document.js";
import {buildNotePdfBuffer} from "./note.js";
import {loadInvoiceCompany} from "./invoice-company.js";
export function businessDocumentRecipient(document:Awaited<ReturnType<typeof loadBusinessDocument>>,channel:"EMAIL"|"WHATSAPP"){
 if(channel==="EMAIL"){
  const to=customerMailRecipients(document.party);if(!to)throw badRequest(`Add the ${document.partyType==="SUPPLIER"?"supplier":"customer"} email address first`);return to;
 }
 if(document.partyType==="CUSTOMER"&&'whatsappInvoiceEnabled' in document.party&&!document.party.whatsappInvoiceEnabled)throw badRequest("Enable WhatsApp delivery on this customer first");
 const phone=normalizeWhatsappPhone(('whatsappPhone' in document.party?document.party.whatsappPhone:null)||document.party.phone);
 if(!phone)throw badRequest(`Add a valid ${document.partyType==="SUPPLIER"?"supplier":"customer"} WhatsApp phone number first`);return "+"+phone;
}
export async function queueBusinessDocument(tenantId:string,actorId:string,kind:BusinessDocumentKind,id:string,channel:"EMAIL"|"WHATSAPP",requestId:string){
 try{return await prisma.$transaction(async tx=>{
  const document=await loadBusinessDocument(tenantId,kind,id,tx),to=businessDocumentRecipient(document,channel);
  const group=channel==="EMAIL"?"SMTP":"WHATSAPP",settings=await tx.setting.findMany({where:{tenantId,group}});
  if(!settings.some(s=>s.key==="enabled"&&s.value==="true")||!settings.some(s=>s.key===(channel==="EMAIL"?"host":"apiKey")&&s.value&&(channel==="EMAIL"||s.isSecret)))throw badRequest(`Configure ${group} in Settings first`);
  const dedupeKey=`${channel}:${kind}:${id}:${requestId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+":"+dedupeKey},0))`;
  const existing=await tx.notificationLog.findUnique({where:{tenantId_dedupeKey:{tenantId,dedupeKey}}});if(existing)return {queued:existing.status==="QUEUED",status:existing.status,notificationId:existing.id};
  const row=await tx.notificationLog.create({data:{tenantId,channel,to,dedupeKey,templateCode:`${kind}_${channel}_MANUAL`,subject:`${document.title} ${document.number}`,body:`Dear ${document.party.name}, please find ${document.title.toLowerCase()} ${document.number} attached.`,refType:kind,refId:id,status:"QUEUED",nextAttemptAt:new Date()}});
  await tx.auditLog.create({data:{tenantId,userId:actorId,action:"DOCUMENT_DELIVERY_QUEUED",entity:kind,entityId:id,after:{notificationId:row.id,channel}}});
  return {queued:true,status:row.status,notificationId:row.id};
 });}catch(e){if(e instanceof BusinessDocumentError)throw badRequest(e.message);throw e;}
}
export async function buildBusinessDocumentPdfBuffer(tenantId:string,kind:BusinessDocumentKind,id:string){
 const document=await loadBusinessDocument(tenantId,kind,id).catch(e=>{if(e instanceof BusinessDocumentError)throw badRequest(e.message);throw e;});
 if(kind==="SALES_DOCUMENT")return {buffer:(await buildSalesDocumentPdfBuffer(tenantId,id)).buffer,document};
 if(kind==="CREDIT_NOTE"||kind==="DEBIT_NOTE")return {buffer:(await buildNotePdfBuffer(tenantId,id,kind==="CREDIT_NOTE"?"credit":"debit")).buffer,document};
 const company=await loadInvoiceCompany(tenantId,true);
 const doc=new PDFDocument({size:"A4",margin:36,bufferPages:true,info:{Title:`${document.title} ${document.number}`}}),chunks:Buffer[]=[];
 const done=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 const money=(n:unknown)=>Number(n).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=(d:Date)=>d.toISOString().slice(0,10).split("-").reverse().join("-");
 let y=36;const left=36,right=559,width=523;
 const text=(value:string,x:number,top:number,w:number,size=9,bold=false,align:"left"|"right"="left")=>{doc.fillColor("#18334b").font(bold?"Helvetica-Bold":"Helvetica").fontSize(size).text(value,x,top,{width:w,align,lineGap:2});return doc.y;};
 const rule=(at:number)=>doc.moveTo(left,at).lineTo(right,at).lineWidth(.6).strokeColor("#d9e2ea").stroke();
 const newPage=()=>{doc.addPage();y=36;text(`${document.title.toUpperCase()} - ${document.number} (continued)`,left,y,width,11,true);y+=28;};
 const ensure=(h:number)=>{if(y+h>770)newPage();};
 text(company.name,left,y,300,16,true);text(document.title.toUpperCase(),340,y,219,12,true,"right");y+=27;
 const companyBottom=text([company.addressLine1,company.addressLine2,[company.city,company.pincode].filter(Boolean).join(" - "),company.gstin?`GSTIN: ${company.gstin}`:"",[company.phone,company.email].filter(Boolean).join(" | ")].filter(Boolean).join("\n"),left,y,290,9);
 const metaBottom=text(`${document.number}\nDate: ${date(document.date)}\nStatus: ${document.status}`,340,y,219,9,true,"right");y=Math.max(companyBottom,metaBottom)+15;rule(y);y+=13;
 y=text(`SUPPLIER\n${document.party.name}\n${'address' in document.party?document.party.address??"":""}\n${document.party.gstin?"GSTIN: "+document.party.gstin:""}\n${[document.party.phone,document.party.email].filter(Boolean).join(" | ")}`,left,y,width,9)+10;
 if(document.reference)y=text(document.reference,left,y,width,9,true)+10;
 const header=()=>{doc.rect(left,y,width,23).fillColor("#edf3f8").fill();text("Description / HSN",43,y+7,235,8,true);text("Qty",281,y+7,40,8,true,"right");text("Rate",329,y+7,65,8,true,"right");text("GST %",399,y+7,45,8,true,"right");text("Amount",452,y+7,100,8,true,"right");y+=27;};header();
 for(const row of document.rows){doc.font("Helvetica").fontSize(9);const description=row.description+(row.hsn?`\nHSN/SAC: ${row.hsn}`:"");const height=Math.max(33,doc.heightOfString(description,{width:230,lineGap:2})+13);if(y+height>730){newPage();header();}const bottom=text(description,43,y+4,230,9);text(String(row.quantity),281,y+4,40,9,false,"right");text(money(row.rate),329,y+4,65,9,false,"right");text(String(row.taxRate),399,y+4,45,9,false,"right");text(money(row.total),452,y+4,100,9,false,"right");y=Math.max(y+height,bottom+8);rule(y);}
 ensure(55);y+=14;text("TOTAL (INR)",310,y,105,11,true);text(money(document.total),420,y,139,12,true,"right");y+=34;
 if(document.notes){doc.font("Helvetica").fontSize(9);ensure(doc.heightOfString(document.notes,{width})+30);y=text(document.notes,left,y,width,9)+20;}
 ensure(45);text("For "+company.name,left,y,width,9,true);y+=20;text("Authorised signatory",left,y,width,8);
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);text(`Generated from saved records | Page ${i+1} of ${range.count}`,left,791,width,8,false,"right");}
 doc.end();return {buffer:await done,document};
}
