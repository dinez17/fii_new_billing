import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
type Tx = Prisma.TransactionClient;
export type JournalSource = "INVOICE"|"PAYMENT"|"PURCHASE"|"SUPPLIER_PAYMENT"|"EXPENSE"|"CREDIT_NOTE"|"DEBIT_NOTE"|"PURCHASE_RETURN"|"WRITE_OFF"|"MANUAL_CASH";
const d=(v: any)=>new Prisma.Decimal(v ?? 0);
const definitions: Record<string,[string,string,boolean?]> = {
 SYS_AR:["Customer receivables","ASSET"], SYS_AP:["Supplier payables","LIABILITY"], SYS_SALES:["Sales and services","INCOME"],
 SYS_PURCHASES:["Purchases (periodic inventory)","EXPENSE"], SYS_SALES_RETURNS:["Sales adjustments","INCOME"], SYS_PURCHASE_RETURNS:["Purchase adjustments","EXPENSE"],
 SYS_CGST_OUT:["Output CGST","LIABILITY"], SYS_SGST_OUT:["Output SGST","LIABILITY"], SYS_IGST_OUT:["Output IGST","LIABILITY"],
 SYS_CGST_IN:["Input CGST","ASSET"], SYS_SGST_IN:["Input SGST","ASSET"], SYS_IGST_IN:["Input IGST","ASSET"],
 SYS_TDS:["TDS receivable","ASSET"], SYS_TAX_PAYABLE:["Income-tax payable","LIABILITY"], SYS_EXPENSE:["Operating expenses","EXPENSE"],
 SYS_CASH:["Cash","ASSET",true], SYS_BANK_UNASSIGNED:["Bank / digital payments — unassigned","ASSET",true],
 SYS_ROUNDING:["Rounding adjustments","INCOME"], SYS_BAD_DEBTS:["Receivable write-offs","EXPENSE"],
 SYS_UNCLASSIFIED:["Unclassified cash adjustments","EQUITY"], SYS_RETAINED:["Retained earnings","EQUITY"], SYS_OPENING:["Verified opening balances","EQUITY"],
};
export async function systemAccounts(tx:Tx,tenantId:string) {
 const codes=Object.keys(definitions).sort();
 await tx.financialAccount.createMany({data:codes.map(code=>{const [name,type,isMoneyAccount=false]=definitions[code];return {tenantId,code,name,type,isMoneyAccount};}),skipDuplicates:true});
 const accounts=await tx.financialAccount.findMany({where:{tenantId,code:{in:codes}}});
 const result:Record<string,string>={};
 for(const account of accounts){const [,type,isMoneyAccount=false]=definitions[account.code];if(account.type!==type||account.isMoneyAccount!==isMoneyAccount||!account.isActive)throw Error("System account configuration disagrees: "+account.code);result[account.code]=account.id;}
 return result;
}

export async function moneyAccount(tx:Tx,tenantId:string,id:string|null|undefined,mode:string|null|undefined) {
 if(id){const a=await tx.financialAccount.findFirst({where:{tenantId,id,isActive:true,isMoneyAccount:true,type:"ASSET"}});if(!a)throw Error("Choose an active cash/bank account belonging to this tenant");return a.id;}
 const accounts=await systemAccounts(tx,tenantId);
 return accounts[mode==="CASH"?"SYS_CASH":"SYS_BANK_UNASSIGNED"];
}
export function sourceFingerprint(row:any) {
 const keys=["fyCode","invoiceDate","paymentDate","expenseDate","noteDate","returnDate","entryDate","customerId","supplierId","financialAccountId","grandTotal","taxableValue","cgst","sgst","igst","total","totalGst","amount","tdsAmount","gstAmount","isInterState","type","mode"];
 return createHash("sha256").update(JSON.stringify({active:!row.reversedAt&&!["CANCELLED","DRAFT","REFUNDED","FAILED","INITIATED"].includes(row.status),...Object.fromEntries(keys.map(k=>[k,row[k]??null]))})).digest("hex");
}
export async function syncSourceJournal(tx:Tx,tenantId:string,kind:JournalSource,id:string,actorId="system") {
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+":"+kind+":"+id},0))`;
 let row:any;
 switch(kind){
  case "INVOICE":row=await tx.invoice.findFirst({where:{tenantId,id}});break;
  case "PAYMENT":row=await tx.payment.findFirst({where:{tenantId,id}});break;
  case "PURCHASE":row=await tx.purchaseInvoice.findFirst({where:{tenantId,id}});break;
  case "SUPPLIER_PAYMENT":row=await tx.supplierPayment.findFirst({where:{tenantId,id}});break;
  case "EXPENSE":row=await tx.expense.findFirst({where:{tenantId,id}});break;
  case "CREDIT_NOTE":row=await tx.creditNote.findFirst({where:{tenantId,id}});break;
  case "DEBIT_NOTE":row=await tx.debitNote.findFirst({where:{tenantId,id}});break;
  case "PURCHASE_RETURN":row=await tx.purchaseReturn.findFirst({where:{tenantId,id}});break;
  case "WRITE_OFF":row=await tx.receivableWriteOff.findFirst({where:{tenantId,id}});break;
  case "MANUAL_CASH":row=await tx.dayBookEntry.findFirst({where:{tenantId,id,source:"MANUAL",OR:[{refType:null},{refType:"MANUAL"}]}});break;
 }
 if(!row)throw Error("Financial source not found in this tenant");
 const active=!row.reversedAt && !["CANCELLED","DRAFT","REFUNDED","FAILED","INITIATED"].includes(row.status);
 const a=await systemAccounts(tx,tenantId),lines:Array<{tenantId:string;accountId:string;debit:Prisma.Decimal;credit:Prisma.Decimal}>=[];
 const line=(code:string,debit:any=0,credit:any=0)=>{const dr=d(debit),cr=d(credit);if(dr.isNegative()||cr.isNegative())throw Error("Negative financial posting");if(dr.gt(0)||cr.gt(0))lines.push({tenantId,accountId:a[code]??code,debit:dr,credit:cr});};
 const entryDate:Date=row.invoiceDate??row.paymentDate??row.expenseDate??row.noteDate??row.returnDate??row.entryDate;
 let fyCode:string=row.fyCode;
 if(!fyCode){const fy=await tx.financialYear.findFirst({where:{tenantId,startDate:{lte:entryDate},endDate:{gte:entryDate}}});if(!fy)throw Error("Financial year missing for source posting");fyCode=fy.code;}
 await tx.$queryRaw`SELECT id FROM "FinancialYear" WHERE "tenantId"=${tenantId} AND code=${fyCode} FOR SHARE`;
 if(active){
  if(["INVOICE","DEBIT_NOTE"].includes(kind)){line("SYS_AR",row.grandTotal??row.total);line("SYS_SALES",0,row.taxableValue);for(const tax of ["CGST","SGST","IGST"])line("SYS_"+tax+"_OUT",0,row[tax.toLowerCase()]);}
  else if(kind==="CREDIT_NOTE"){line("SYS_AR",0,row.total);line("SYS_SALES_RETURNS",row.taxableValue);for(const tax of ["CGST","SGST","IGST"])line("SYS_"+tax+"_OUT",row[tax.toLowerCase()]);}
  else if(kind==="PURCHASE"){line("SYS_AP",0,row.grandTotal);line("SYS_PURCHASES",row.taxableValue);for(const tax of ["CGST","SGST","IGST"])line("SYS_"+tax+"_IN",row[tax.toLowerCase()]);}
  else if(kind==="PURCHASE_RETURN"){line("SYS_AP",row.total);line("SYS_PURCHASE_RETURNS",0,row.taxableValue);const pi=await tx.purchaseInvoice.findFirst({where:{tenantId,id:row.purchaseInvoiceId}});const gst=d(row.totalGst),half=gst.div(2).toDecimalPlaces(2);if(pi?.isInterState)line("SYS_IGST_IN",0,gst);else{line("SYS_CGST_IN",0,half);line("SYS_SGST_IN",0,gst.sub(half));}}
  else if(kind==="WRITE_OFF"){line("SYS_BAD_DEBTS",row.amount);line("SYS_AR",0,row.amount);}
  else {
   const cash=await moneyAccount(tx,tenantId,row.financialAccountId,row.mode);
   if(kind==="PAYMENT"){line(cash,row.amount);line("SYS_TDS",row.tdsAmount);line("SYS_AR",0,d(row.amount).add(row.tdsAmount));}
   else if(kind==="SUPPLIER_PAYMENT"){line("SYS_AP",row.amount);line(cash,0,row.amount);}
   else if(kind==="EXPENSE"){line("SYS_EXPENSE",row.amount);line(cash,0,row.total);const gst=d(row.gstAmount),half=gst.div(2).toDecimalPlaces(2);if(row.isInterState)line("SYS_IGST_IN",gst);else{line("SYS_CGST_IN",half);line("SYS_SGST_IN",gst.sub(half));}}
   else if(kind==="MANUAL_CASH"){if(row.type==="CASH_IN"){line(cash,row.amount);line("SYS_UNCLASSIFIED",0,row.amount);}else{line("SYS_UNCLASSIFIED",row.amount);line(cash,0,row.amount);}}
  }
 }
 const delta=lines.reduce((n,l)=>n.add(l.debit).sub(l.credit),d(0));
 if(delta.abs().gt(1))throw Error("Financial source totals disagree by more than rounding; reconcile before posting");
 if(delta.gt(0))line("SYS_ROUNDING",0,delta);else if(delta.lt(0))line("SYS_ROUNDING",delta.abs());
 const signature=createHash("sha256").update(JSON.stringify({active,fyCode,entryDate,party:row.customerId??row.supplierId,lines:lines.map(l=>[l.accountId,l.debit.toFixed(2),l.credit.toFixed(2)])})).digest("hex");
 const key={tenantId,group:"JOURNAL_SOURCE_STATE",key:kind+":"+id},state=await tx.setting.findUnique({where:{tenantId_group_key:key}}),old=state?JSON.parse(state.value):null;
 if(old?.signature===signature){if(old.sourceFingerprint!==sourceFingerprint(row))await tx.setting.update({where:{tenantId_group_key:key},data:{value:JSON.stringify({...old,sourceFingerprint:sourceFingerprint(row)})}});return {changed:false,journalId:old.journalId};}
 const closed=await tx.setting.findUnique({where:{tenantId_group_key:{tenantId,group:"YEAR_END_CLOSE",key:fyCode}}});
 if(closed&&JSON.parse(closed.value).status==="CLOSED"&&!row.reversedAt)throw Error("Reopen the closed accounting year before changing its journal postings");
 if(old?.journalId){
  const original=await tx.journalEntry.findFirstOrThrow({where:{tenantId,id:old.journalId},include:{lines:true}});
  const reversalDate=row.reversedAt??original.entryDate; const reversalYear=await tx.financialYear.findFirst({where:{tenantId,startDate:{lte:reversalDate},endDate:{gte:reversalDate}}});
  if(!await tx.journalEntry.findFirst({where:{tenantId,reversalOf:original.id}}))await tx.journalEntry.create({data:{tenantId,fyCode:reversalYear?.code??original.fyCode,entryDate:reversalDate,narration:"Automatic reversal: "+kind+" source corrected/cancelled",source:"AUTO_REVERSAL",sourceId:original.id,reversalOf:original.id,createdById:actorId,lines:{create:original.lines.map(l=>({tenantId,accountId:l.accountId,debit:l.credit,credit:l.debit}))}}});
 }
 let journalId:string|null=null;
 if(lines.length){if(lines.length<2)throw Error("Financial source cannot produce a balanced journal");const journal=await tx.journalEntry.create({data:{tenantId,fyCode,entryDate,narration:kind+" "+(row.invoiceNumber??row.ourNumber??row.noteNumber??row.voucherNumber??row.reference??id),source:"AUTO_"+kind,sourceId:id+":"+randomUUID(),createdById:actorId,lines:{create:lines}}});journalId=journal.id;}
 await tx.setting.upsert({where:{tenantId_group_key:key},create:{...key,value:JSON.stringify({signature,journalId,sourceFingerprint:sourceFingerprint(row)})},update:{value:JSON.stringify({signature,journalId,sourceFingerprint:sourceFingerprint(row)})}});
 return {changed:true,journalId};
}
export async function journalForEvent(tx:Tx,tenantId:string,topic:string,event:any){
 const p=event.payload??{},actor=event.actorUserId??"system";
 const map:Record<string,[JournalSource,string]>={"invoice.created":["INVOICE",p.invoiceId],"invoice.updated":["INVOICE",p.invoiceId],"invoice.cancelled":["INVOICE",p.invoiceId],"payment.success":["PAYMENT",p.paymentId],"purchase.invoice.created":["PURCHASE",p.purchaseInvoiceId],"supplier.payment.paid":["SUPPLIER_PAYMENT",p.supplierPaymentId],"purchase.return.created":["PURCHASE_RETURN",p.purchaseReturnId],"expense.created":["EXPENSE",p.expenseId],"note.created":[p.kind==="credit"?"CREDIT_NOTE":"DEBIT_NOTE",p.noteId],"note.cancelled":[p.kind==="credit"?"CREDIT_NOTE":"DEBIT_NOTE",p.noteId]};
 const item=map[topic];if(item?.[1])await syncSourceJournal(tx,tenantId,item[0],item[1],actor);
}
