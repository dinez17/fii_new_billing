import {prisma} from "./client.js";
import type {Prisma} from "@prisma/client";
export const BUSINESS_DOCUMENT_KINDS=["SALES_DOCUMENT","CREDIT_NOTE","DEBIT_NOTE","PURCHASE_ORDER","PURCHASE_INVOICE","PURCHASE_RETURN"] as const;
export type BusinessDocumentKind=typeof BUSINESS_DOCUMENT_KINDS[number];
export class BusinessDocumentError extends Error {}
export async function loadBusinessDocument(tenantId:string,kind:BusinessDocumentKind,id:string,db:Prisma.TransactionClient=prisma){
 const invalid=()=>new BusinessDocumentError("Document unavailable, cancelled or outside this tenant");
 if(kind==="SALES_DOCUMENT"){
  const d=await db.salesDocument.findFirst({where:{id,tenantId,status:{not:"CANCELLED"}},include:{customer:true}});if(!d||d.customer.tenantId!==tenantId)throw invalid();
  return {kind,id,number:d.documentNumber,title:d.kind==="QUOTATION"?"Quotation":"Proforma invoice",date:d.documentDate,party:d.customer,partyType:"CUSTOMER" as const,status:d.status,total:d.grandTotal,reference:"",notes:d.notes??"",rows:[]};
 }
 if(kind==="CREDIT_NOTE"||kind==="DEBIT_NOTE"){
  const delegate=kind==="CREDIT_NOTE"?db.creditNote:db.debitNote;
  const d=await (delegate as typeof db.creditNote).findFirst({where:{id,tenantId,status:{not:"CANCELLED"}},include:{invoice:{include:{customer:true}}}});
  if(!d||d.invoice.tenantId!==tenantId||d.invoice.customer.tenantId!==tenantId)throw invalid();
  return {kind,id,number:d.noteNumber,title:kind==="CREDIT_NOTE"?"Credit note / Sales return":"Debit note",date:d.noteDate,party:d.invoice.customer,partyType:"CUSTOMER" as const,status:d.status,total:d.total,reference:d.invoice.invoiceNumber,notes:d.reason,rows:[]};
 }
 if(kind==="PURCHASE_ORDER"){
  const d=await db.purchaseOrder.findFirst({where:{id,tenantId,status:{not:"CANCELLED"}},include:{supplier:true,items:{include:{product:true}}}});if(!d||d.supplier.tenantId!==tenantId||d.items.some(i=>i.product.tenantId!==tenantId))throw invalid();
  return {kind,id,number:d.poNumber,title:"Purchase order",date:d.orderDate,party:d.supplier,partyType:"SUPPLIER" as const,status:d.status,total:d.total,reference:"",notes:d.notes??"",rows:d.items.map(i=>({description:i.product.name,hsn:i.product.hsnSac??"",quantity:Number(i.quantity),rate:Number(i.unitPrice),taxRate:Number(i.gstRate),total:Number(i.quantity)*Number(i.unitPrice)*(1+Number(i.gstRate)/100)}))};
 }
 if(kind==="PURCHASE_INVOICE"){
  const d=await db.purchaseInvoice.findFirst({where:{id,tenantId,status:{not:"CANCELLED"}},include:{supplier:true,items:{include:{product:true}}}});if(!d||d.supplier.tenantId!==tenantId||d.items.some(i=>i.product.tenantId!==tenantId))throw invalid();
  return {kind,id,number:d.ourNumber,title:"Purchase invoice summary",date:d.invoiceDate,party:d.supplier,partyType:"SUPPLIER" as const,status:d.status,total:d.grandTotal,reference:`Supplier bill: ${d.billNumber}`,notes:"Summary of the recorded supplier invoice; retain the supplier's original tax invoice.",rows:d.items.map(i=>({description:i.product.name,hsn:i.hsnSac??"",quantity:Number(i.quantity),rate:Number(i.unitPrice),taxRate:Number(i.gstRate),total:Number(i.lineTotal)}))};
 }
 const d=await db.purchaseReturn.findFirst({where:{id,tenantId},include:{supplier:true,purchaseInvoice:true}});if(!d||d.supplier.tenantId!==tenantId||d.purchaseInvoice.tenantId!==tenantId)throw invalid();
 const items=d.items as {productId:string;quantity?:number;qty?:number;unitPrice:number;gstRate:number}[];
 const products=await db.product.findMany({where:{tenantId,id:{in:items.map(i=>i.productId)}},select:{id:true,name:true,hsnSac:true}});
 return {kind,id,number:d.returnNumber,title:"Purchase return",date:d.returnDate,party:d.supplier,partyType:"SUPPLIER" as const,status:"ISSUED",total:d.total,reference:`Against: ${d.purchaseInvoice.ourNumber} / ${d.purchaseInvoice.billNumber}`,notes:d.reason??"",rows:items.map((i,index)=>({description:products.find(p=>p.id===i.productId)?.name??`Returned item ${index+1}`,hsn:products.find(p=>p.id===i.productId)?.hsnSac??"",quantity:Number(i.quantity??i.qty??0),rate:Number(i.unitPrice),taxRate:Number(i.gstRate),total:Number(i.quantity??i.qty??0)*Number(i.unitPrice)*(1+Number(i.gstRate)/100)}))};
}
