import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { computeDayBookDay, computeDayBookPeriod, saveDayBookClosing } from "../src/daybook-balances.js";
const suite=process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("delayed daybook reconciliation and late-change detection",()=>{
 let tenantId="",otherId="",actorId="";
 const day=new Date("2026-10-28"),now=new Date("2026-10-31T08:00:00Z");
 async function entry(date: string,amount:number,type:"CASH_IN"|"CASH_OUT"="CASH_IN",tenant=tenantId){return prisma.dayBookEntry.create({data:{tenantId:tenant,fyCode:"2026-27",entryDate:new Date(date),type,mode:"BANK_TRANSFER",source:"MANUAL",amount}});}
 beforeAll(async()=>{
  const stamp=Date.now();tenantId=(await prisma.tenant.create({data:{name:"Close test",subdomain:`close-${stamp}`}})).id;
  otherId=(await prisma.tenant.create({data:{name:"Other close",subdomain:`close-other-${stamp}`}})).id;
  actorId=(await prisma.user.create({data:{tenantId,name:"Reviewer",email:"review@example.test",passwordHash:"fixture-only",userType:"STAFF"}})).id;
  await prisma.financialYear.create({data:{tenantId,code:"2026-27",startDate:new Date("2026-04-01"),endDate:new Date("2027-03-31T23:59:59.999Z"),isActive:true}});
  await entry("2026-10-27",100);await entry("2026-10-28",50);await entry("2026-10-28",20,"CASH_OUT");await entry("2026-10-28",999,"CASH_IN",otherId);
 });
 afterAll(async()=>{const where={tenantId:{in:[tenantId,otherId]}};await prisma.auditLog.deleteMany({where});await prisma.setting.deleteMany({where});await prisma.dayBookClosing.deleteMany({where});await prisma.dayBookEntry.deleteMany({where});await prisma.user.deleteMany({where});await prisma.financialYear.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:[tenantId,otherId]}}});await prisma.$disconnect();});
 it("saves a date three days later, with correct cash/bank opening and closing",async()=>{
  const before=await computeDayBookDay(tenantId,day);expect(before).toMatchObject({opening:100,cashIn:50,cashOut:20,closing:130,closed:false});
  await saveDayBookClosing(tenantId,actorId,day,"Cash and bank reviewed",now);
  expect(await computeDayBookDay(tenantId,day)).toMatchObject({closing:130,closed:true,needsReview:false});
  expect(await computeDayBookPeriod(tenantId,{from:day,to:day})).toMatchObject({closed:true,needsReview:false});
 });
 it("flags offsetting late changes even if closing total stays unchanged",async()=>{
  await entry("2026-10-28",10);await entry("2026-10-28",10,"CASH_OUT");
  expect(await computeDayBookDay(tenantId,day)).toMatchObject({closing:130,closed:false,needsReview:true});
  await saveDayBookClosing(tenantId,actorId,day,"Reviewed late entries",now);
  expect((await computeDayBookDay(tenantId,day)).closed).toBe(true);
 });
 it("recomputes opening after a backdated change before the saved closing",async()=>{
  await entry("2026-10-27",5);
  expect(await computeDayBookDay(tenantId,day)).toMatchObject({opening:105,closing:135,needsReview:true});
  expect((await computeDayBookDay(tenantId,new Date("2026-10-29"))).opening).toBe(135);
  expect((await computeDayBookDay(otherId,day)).closing).toBe(999);
  expect(await prisma.auditLog.count({where:{tenantId,entity:"DayBookClosing"}})).toBe(2);
 });
 it("rejects future closing and keeps original dates and balances intact",async()=>{
  const before=await prisma.dayBookClosing.count({where:{tenantId}});
  await expect(saveDayBookClosing(tenantId,actorId,new Date("2026-11-01"),"Future closing",now)).rejects.toThrow(/future/);
  expect(await prisma.dayBookClosing.count({where:{tenantId}})).toBe(before);
 });
});
