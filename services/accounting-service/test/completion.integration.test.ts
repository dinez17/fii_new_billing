import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import express from "express";
import type {Server} from "node:http";
import {prisma,systemAccounts,syncSourceJournal,moneyAccount,applySubscriberSchedules,plannedSubscriberStatus,computeTallyPnl,computeBalanceSheet,createTenantBackup} from "@fii/database";
import {encryptSecret} from "@fii/common";
import {writeOff,clearTds,sourceRows,completionRouter} from "../src/completion-workflows.js";
import {yearEndCloseRouter,closingPlan} from "../src/year-end-close.js";
import {yearEndSnapshot} from "../src/financial-controls.js";
const identity=vi.hoisted(()=>({tenantId:"",sub:"",userType:"STAFF",roleIds:[]}));
vi.mock("@fii/auth",()=>({authenticate:(req:any,_res:any,next:any)=>{req.auth=identity;next();},authorize:()=> (_req:any,_res:any,next:any)=>next(),permissionsForRoles:async()=>new Set(["report:read"])}));
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("completed financial controls",()=>{
 let tenantId="",otherId="",actorId="",customerId="",invoiceId="",paymentId="",bank="",foreign="",subId="",server:Server,base="";
 const date=new Date("2026-10-01"),a:Record<string,string>={};
 const tx=(fn:any)=>prisma.$transaction(fn,{timeout:30000});
 async function request(path:string,body:any){const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
 beforeAll(async()=>{
  tenantId=(await prisma.tenant.create({data:{name:"Completion test",subdomain:"completion-"+randomUUID(),stateCode:"33"}})).id;
  otherId=(await prisma.tenant.create({data:{name:"Foreign test",subdomain:"completion-other-"+randomUUID()}})).id;
  actorId=(await prisma.user.create({data:{tenantId,name:"Reviewer",email:"completion@example.test",passwordHash:"fixture"}})).id;Object.assign(identity,{tenantId,sub:actorId});
  customerId=(await prisma.customer.create({data:{tenantId,name:"Customer",code:"C1"}})).id;
  await prisma.financialYear.createMany({data:[{tenantId,code:"2026-27",startDate:new Date("2026-04-01"),endDate:new Date("2027-03-31"),isActive:true},{tenantId,code:"2025-26",startDate:new Date("2025-04-01"),endDate:new Date("2026-03-31")} ]});
  Object.assign(a,await tx((t:any)=>systemAccounts(t,tenantId)));
  bank=(await prisma.financialAccount.create({data:{tenantId,code:"BANK",name:"Verified bank",type:"ASSET",isMoneyAccount:true}})).id;
  foreign=(await prisma.financialAccount.create({data:{tenantId:otherId,code:"BANK",name:"Foreign bank",type:"ASSET",isMoneyAccount:true}})).id;
  invoiceId=(await prisma.invoice.create({data:{tenantId,customerId,invoiceNumber:"TEST-1",fyCode:"2026-27",invoiceDate:date,dueDate:date,placeOfSupply:"33",subTotal:100,taxableValue:100,cgst:9,sgst:9,grandTotal:118}})).id;
  const app=express();app.use(express.json());app.use(completionRouter);app.use(yearEndCloseRouter);app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.statusCode??err.status??400).json({message:err.message}));server=await new Promise<Server>(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});base="http://127.0.0.1:"+(server.address() as any).port;
 });
 afterAll(async()=>{
  if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
  const where={tenantId:{in:[tenantId,otherId]}};
  await prisma.tdsClearing.deleteMany({where});await prisma.receivableWriteOff.deleteMany({where});await prisma.subscriberSchedule.deleteMany({where});await prisma.subscriberPlan.deleteMany({where});await prisma.subscriber.deleteMany({where});await prisma.plan.deleteMany({where});
  await prisma.auditLog.deleteMany({where});await prisma.setting.deleteMany({where});await prisma.dayBookEntry.deleteMany({where});await prisma.ledgerEntry.deleteMany({where});await prisma.payment.deleteMany({where});await prisma.creditNote.deleteMany({where});await prisma.debitNote.deleteMany({where});await prisma.invoice.deleteMany({where});await prisma.expense.deleteMany({where});await prisma.expenseCategory.deleteMany({where});await prisma.supplierPayment.deleteMany({where});await prisma.purchaseReturn.deleteMany({where});await prisma.purchaseInvoice.deleteMany({where});await prisma.supplier.deleteMany({where});
  await prisma.$transaction([prisma.journalLine.deleteMany({where}),prisma.journalEntry.deleteMany({where})]);await prisma.financialAccount.deleteMany({where});await prisma.customer.deleteMany({where});await prisma.financialYear.deleteMany({where});await prisma.user.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:[tenantId,otherId]}}});await prisma.$disconnect();
 });
 it("posts GST sales once, corrects by reversal, and rejects foreign source/account IDs",async()=>{
  const first:any=await tx((t:any)=>syncSourceJournal(t,tenantId,"INVOICE",invoiceId,actorId));expect(first.changed).toBe(true);
  expect((await tx((t:any)=>syncSourceJournal(t,tenantId,"INVOICE",invoiceId,actorId)) as any).changed).toBe(false);
  await expect(tx((t:any)=>moneyAccount(t,tenantId,foreign,"BANK_TRANSFER"))).rejects.toThrow(/belonging/);
  await expect(tx((t:any)=>syncSourceJournal(t,otherId,"INVOICE",invoiceId))).rejects.toThrow(/not found/);
  await prisma.invoice.update({where:{id:invoiceId},data:{status:"CANCELLED"}});await tx((t:any)=>syncSourceJournal(t,tenantId,"INVOICE",invoiceId));
  expect(await prisma.journalEntry.count({where:{tenantId,reversalOf:first.journalId}})).toBe(1);
  await prisma.invoice.update({where:{id:invoiceId},data:{status:"UNPAID"}});await tx((t:any)=>syncSourceJournal(t,tenantId,"INVOICE",invoiceId));
  const lines=await prisma.journalLine.groupBy({by:["accountId"],where:{tenantId},_sum:{debit:true,credit:true}});const ar=lines.find(l=>l.accountId===a.SYS_AR)!;expect(Number(ar._sum.debit)-Number(ar._sum.credit)).toBe(118);
  const preview:any=await tx((t:any)=>sourceRows(t,tenantId,"INVOICE","2026-27"));expect(preview.items[0].posted).toBe(true);
 });
 it("posts purchases, supplier payments, returns, notes, expenses and manual cash with balanced journals",async()=>{
  const supplier=await prisma.supplier.create({data:{tenantId,code:"S1",name:"Supplier"}});
  const purchase=await prisma.purchaseInvoice.create({data:{tenantId,supplierId:supplier.id,billNumber:"PB1",ourNumber:"P1",fyCode:"2026-27",invoiceDate:date,subTotal:100,taxableValue:100,cgst:9,sgst:9,grandTotal:118}});
  const paid=await prisma.supplierPayment.create({data:{tenantId,supplierId:supplier.id,voucherNumber:"V1",fyCode:"2026-27",paymentDate:date,amount:50,mode:"BANK_TRANSFER",financialAccountId:bank}});
  const returned=await prisma.purchaseReturn.create({data:{tenantId,supplierId:supplier.id,purchaseInvoiceId:purchase.id,returnNumber:"RT1",fyCode:"2026-27",returnDate:date,taxableValue:10,totalGst:1.8,total:11.8,items:[]}});
  const category=await prisma.expenseCategory.create({data:{tenantId,name:"Office"}});
  const expense=await prisma.expense.create({data:{tenantId,categoryId:category.id,fyCode:"2026-27",expenseDate:date,description:"Office expense",amount:10,gstAmount:1.8,total:11.8,mode:"CASH"}});
  const note={tenantId,invoiceId,customerId,fyCode:"2026-27",noteDate:date,reason:"Adjustment",taxableValue:10,cgst:0.9,sgst:0.9,total:11.8,items:[]};
  const cn=await prisma.creditNote.create({data:{...note,noteNumber:"CN1"}}),dn=await prisma.debitNote.create({data:{...note,noteNumber:"DN1"}});
  const manual=await prisma.dayBookEntry.create({data:{tenantId,fyCode:"2026-27",entryDate:date,type:"CASH_IN",source:"MANUAL",amount:2,mode:"CASH"}});
  for(const [kind,id] of [["PURCHASE",purchase.id],["SUPPLIER_PAYMENT",paid.id],["PURCHASE_RETURN",returned.id],["EXPENSE",expense.id],["CREDIT_NOTE",cn.id],["DEBIT_NOTE",dn.id],["MANUAL_CASH",manual.id]] as const){
   const result:any=await tx((t:any)=>syncSourceJournal(t,tenantId,kind,id));const lines=await prisma.journalLine.findMany({where:{journalId:result.journalId}});expect(lines.reduce((n,l)=>n+Number(l.debit)-Number(l.credit),0)).toBeCloseTo(0,8);
  }
  await prisma.expense.update({where:{id:expense.id},data:{status:"CANCELLED"}});await tx((t:any)=>syncSourceJournal(t,tenantId,"EXPENSE",expense.id));

 });
 it("writes off only receivables and reverses without altering GST or collections",async()=>{
  const profitBefore=(await computeTallyPnl(tenantId,new Date("2026-04-01"),date)).netProfit;
  const row:any=await tx((t:any)=>writeOff(t,tenantId,actorId,{invoiceId,amount:18,date,reason:"Verified bad debt adjustment"}));
  expect(Number((await prisma.invoice.findUniqueOrThrow({where:{id:invoiceId}})).creditedAmount)).toBe(18);
  expect((await computeTallyPnl(tenantId,new Date("2026-04-01"),date)).netProfit).toBe(profitBefore-18);
  expect(await prisma.dayBookEntry.count({where:{tenantId,refType:"WRITE_OFF"}})).toBe(0);
  await expect(tx((t:any)=>writeOff(t,tenantId,actorId,{invoiceId,amount:101,date,reason:"Over balance"}))).rejects.toThrow(/exceeds/);
  expect((await request(`/write-offs/${row.id}/reverse`,{date:"2026-10-02",reason:"Customer confirmed full collection"})).status).toBe(200);
  expect((await request(`/write-offs/${row.id}/reverse`,{date:"2026-10-02",reason:"Repeated reversal should fail"})).status).toBeGreaterThanOrEqual(400);
  expect((await prisma.invoice.findUniqueOrThrow({where:{id:invoiceId}})).cgst.toFixed(2)).toBe("9.00");
 });
 it("clears verified TDS against an actual liability or refund, enforcing caps",async()=>{
  paymentId=(await prisma.payment.create({data:{tenantId,customerId,fyCode:"2026-27",amount:90,tdsAmount:10,mode:"BANK_TRANSFER",financialAccountId:bank,paymentDate:date}})).id;
  await expect(prisma.payment.update({where:{id:paymentId},data:{financialAccountId:foreign}})).rejects.toThrow(/another tenant/);
  await prisma.setting.create({data:{tenantId,group:"TDS_RECONCILIATION",key:paymentId,value:encryptSecret(JSON.stringify({verifiedAmount:10}))}});
  await expect(tx((t:any)=>clearTds(t,tenantId,actorId,{paymentId,amount:5,date,kind:"APPLIED",reference:"Verified assessment"}))).rejects.toThrow(/liability/);
  await tx((t:any)=>t.journalEntry.create({data:{tenantId,fyCode:"2026-27",entryDate:date,narration:"Verified tax assessment",source:"MANUAL",createdById:actorId,lines:{create:[{tenantId,accountId:a.SYS_EXPENSE,debit:5},{tenantId,accountId:a.SYS_TAX_PAYABLE,credit:5}]}}}));
  await tx((t:any)=>clearTds(t,tenantId,actorId,{paymentId,amount:5,date,kind:"APPLIED",reference:"Verified assessment"}));
  const refund:any=await tx((t:any)=>clearTds(t,tenantId,actorId,{paymentId,amount:5,date,kind:"REFUND",reference:"Bank refund advice",financialAccountId:bank}));
  await expect(tx((t:any)=>clearTds(t,tenantId,actorId,{paymentId,amount:1,date,kind:"REFUND",reference:"Extra refund",financialAccountId:bank}))).rejects.toThrow(/uncleared/);
  expect((await computeBalanceSheet(tenantId,date)).detail.tdsReceivable).toBe(0);
  expect(Number((await prisma.dayBookEntry.findFirstOrThrow({where:{tenantId,refType:"TDS_REFUND"}})).amount)).toBe(5);
  expect((await request(`/tds-clearings/${refund.id}/reverse`,{date:"2026-10-02",reason:"Refund bank advice reversed"})).status).toBe(200);
  expect((await computeBalanceSheet(tenantId,new Date("2026-10-02"))).detail.tdsReceivable).toBe(5);
 });
 it("closes a reconciled past year and reopens with exact reversals and unchanged profit basis",async()=>{
  await tx((t:any)=>t.journalEntry.create({data:{tenantId,fyCode:"2025-26",entryDate:new Date("2025-05-01"),source:"MANUAL",createdById:actorId,narration:"Historical verified sale",lines:{create:[{tenantId,accountId:bank,debit:100},{tenantId,accountId:a.SYS_SALES,credit:100}]}}}));
  const snap=await prisma.$transaction(t=>yearEndSnapshot(t,tenantId,"2025-26"));await prisma.setting.create({data:{tenantId,group:"YEAR_END_REVIEW",key:"2025-26",value:JSON.stringify({signature:snap.signature})}});
  const preview=await prisma.$transaction(t=>closingPlan(t,tenantId,"2025-26"));expect(preview.blockers).toEqual([]);expect(preview.profit).toBe("100.00");
  const closed=await request("/year-end/2025-26/close",{signature:preview.signature,note:"Verified all historical balances and statement records",confirm:true});expect(closed.data).toMatchObject({closed:true});
  expect((await prisma.financialYear.findUniqueOrThrow({where:{tenantId_code:{tenantId,code:"2025-26"}}})).isLocked).toBe(true);
  expect(await prisma.journalEntry.count({where:{tenantId,source:"YEAR_END_CLOSING"}})).toBe(1);
  const reopened=await request("/year-end/2025-26/reopen",{reason:"Reopen to review a corrected historical source document",confirm:true});expect(reopened.data).toMatchObject({reopened:true});
  expect(await prisma.journalEntry.count({where:{tenantId,source:"YEAR_END_REOPEN"}})).toBe(1);
  expect(await prisma.setting.count({where:{tenantId,group:"ACCOUNTING",key:"profitCarryForwardStart"}})).toBe(0);
 });
 it("applies scheduled lifecycle once, preserves another tenant and projects future pauses",async()=>{
  const plan=await prisma.plan.create({data:{tenantId,name:"Service",code:"PLAN",price:100}});
  subId=(await prisma.subscriber.create({data:{tenantId,customerId,code:"SUB1",subscriberType:"PREPAID",activationDate:date}})).id;
  await prisma.subscriberPlan.create({data:{tenantId,subscriberId:subId,planId:plan.id,startDate:date}});
  await prisma.subscriberSchedule.createMany({data:[{tenantId,subscriberId:subId,action:"PAUSE",effectiveDate:date,note:"Customer requested pause",createdById:actorId},{tenantId,subscriberId:subId,action:"RESUME",effectiveDate:new Date("2026-10-03"),note:"Customer requested resume",createdById:actorId},{tenantId,subscriberId:subId,action:"TERMINATE",effectiveDate:new Date("2026-10-04"),note:"Customer requested stop",createdById:actorId}]});
  expect(await tx((t:any)=>applySubscriberSchedules(t,otherId,date))).toBe(0);
  expect(await tx((t:any)=>applySubscriberSchedules(t,tenantId,date))).toBe(1);expect(await tx((t:any)=>applySubscriberSchedules(t,tenantId,date))).toBe(0);
  expect((await prisma.subscriber.findUniqueOrThrow({where:{id:subId}})).status).toBe("SUSPENDED");
  expect(await tx((t:any)=>applySubscriberSchedules(t,tenantId,new Date("2026-10-04")))).toBe(2);
  expect((await prisma.subscriberPlan.findFirstOrThrow({where:{subscriberId:subId}})).endDate?.toISOString().slice(0,10)).toBe("2026-10-04");
  expect(plannedSubscriberStatus("ACTIVE",[{status:"PENDING",action:"PAUSE",effectiveDate:new Date("2026-11-01")}],new Date("2027-01-01"))).toBe("SUSPENDED");
  const backup=await createTenantBackup(tenantId);expect(backup.tables.SubscriberSchedule).toHaveLength(3);expect(backup.tables.TdsClearing).toHaveLength(2);expect(backup.tables.ReceivableWriteOff).toHaveLength(1);
 });
});
