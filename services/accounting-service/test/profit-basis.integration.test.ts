import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma,computeTallyPnl,computeBalanceSheet } from "@fii/database";
import { generate } from "../../../workers/report-worker/src/generators.js";
const suite=process.env.RUN_INTEGRATION_TESTS === "true"?describe:describe.skip;
suite("current-year profit basis",()=>{
 let tenantId="",customerId="";
 beforeAll(async()=>{
  tenantId=(await prisma.tenant.create({data:{name:"Profit basis",subdomain:`profit-basis-${Date.now()}`}})).id;
  customerId=(await prisma.customer.create({data:{tenantId,code:"C1",name:"Historical customer",openingBalance:75}})).id;
  await prisma.financialYear.createMany({data:[{tenantId,code:"2026-27",startDate:new Date("2026-04-01"),endDate:new Date("2027-03-31T23:59:59Z"),isActive:true},{tenantId,code:"2027-28",startDate:new Date("2027-04-01"),endDate:new Date("2028-03-31T23:59:59Z")} ]});
  for(const [number,date,amount,status] of [["OLD","2026-03-31",5000,"PAID"],["NEW","2026-04-01",1200,"UNPAID"],["DRAFT","2026-04-02",50000,"DRAFT"],["CANCELLED","2026-04-03",80000,"CANCELLED"]] as const) await prisma.invoice.create({data:{tenantId,customerId,invoiceNumber:number,fyCode:number==="OLD"?"2025-26":"2026-27",invoiceDate:new Date(date),dueDate:new Date(date),placeOfSupply:"33",subTotal:amount,taxableValue:amount,grandTotal:amount,status}});
  const supplier=await prisma.supplier.create({data:{tenantId,code:"S1",name:"Cancelled supplier"}});
  await prisma.purchaseInvoice.create({data:{tenantId,supplierId:supplier.id,billNumber:"CANCELLED",ourNumber:"PC1",fyCode:"2026-27",invoiceDate:new Date("2026-04-01"),subTotal:90000,taxableValue:90000,grandTotal:90000,status:"CANCELLED"}});
 });
 afterAll(async()=>{const where={tenantId};await prisma.setting.deleteMany({where});await prisma.invoice.deleteMany({where});await prisma.purchaseInvoice.deleteMany({where});await prisma.supplier.deleteMany({where});await prisma.customer.deleteMany({where});await prisma.financialYear.deleteMany({where});await prisma.tenant.delete({where:{id:tenantId}});await prisma.$disconnect();});
 it("keeps selected FY profit separate and excludes drafts and cancelled purchases in live/export reports",async()=>{
  const pnl=await computeTallyPnl(tenantId,new Date("2026-04-01"),new Date("2026-10-31"));expect(pnl.netProfit).toBe(1200);
  const report=await generate("PROFIT_LOSS",tenantId,{from:"2026-04-01",to:"2026-10-31"});expect(report.rows).toContainEqual(["Net profit",1200]);
  expect((await computeBalanceSheet(tenantId,new Date("2026-10-31"))).detail.retainedEarnings).toBe(5000);
 });
 it("resets only prior-profit carry-forward and retains historical invoices and customer opening",async()=>{
  await prisma.setting.create({data:{tenantId,group:"ACCOUNTING",key:"profitCarryForwardStart",value:"2026-04-01",isSecret:false}});
  const sheet=await computeBalanceSheet(tenantId,new Date("2026-10-31"));expect(sheet.detail.retainedEarnings).toBe(0);expect(sheet.detail.profitAndLoss).toBe(1200);
  expect(await prisma.invoice.count({where:{tenantId}})).toBe(4);expect(Number((await prisma.customer.findUniqueOrThrow({where:{id:customerId}})).openingBalance)).toBe(75);
  const next=await computeBalanceSheet(tenantId,new Date("2027-04-01"));expect(next.detail.retainedEarnings).toBe(1200);expect(next.detail.profitAndLoss).toBe(0);
 });
});
