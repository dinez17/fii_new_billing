import { Prisma, prisma } from "@fii/database";
import { badRequest } from "@fii/common";
import { dayStart, dayEnd, n } from "./util.js";
type Db = Prisma.TransactionClient;
const group = "DAYBOOK_RECONCILIATION";
const round = (v: number) => Math.round(v * 100) / 100;
export function indiaToday(now = new Date()) { return new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)); }
async function openingBalance(db: Db, tenantId: string, date: Date) {
  const rows = await db.dayBookEntry.groupBy({ by: ["type"], where: { tenantId, entryDate: { lt: dayStart(date) } }, _sum: { amount: true } });
  return round(rows.reduce((sum,row) => sum + (row.type === "CASH_IN" ? 1 : -1) * n(row._sum.amount),0));
}
async function fingerprint(db: Db, tenantId: string, date: Date) {
  const result = await db.$queryRaw<{ hash: string }[]>`SELECT md5(COALESCE(string_agg(md5(to_jsonb(e)::text), '' ORDER BY e.id), '')) AS hash FROM "DayBookEntry" e WHERE e."tenantId" = ${tenantId} AND e."entryDate" <= ${dayEnd(date)}`;
  return result[0]!.hash;
}
async function closingState(db: Db, tenantId: string, date: Date) {
  const saved = await db.dayBookClosing.findUnique({ where: { tenantId_closingDate: { tenantId, closingDate: dayStart(date) } } });
  if (!saved) return { closed: false, needsReview: false, lastClose: null };
  const metadata = await db.setting.findUnique({ where: { tenantId_group_key: { tenantId, group, key: dayStart(date).toISOString().slice(0,10) } } });
  let review: { fingerprint?: string; note?: string; reviewedAt?: string } = {};
  try { if (metadata) review = JSON.parse(metadata.value); } catch { /* A missing/invalid snapshot must be reviewed again. */ }
  const needsReview = review.fingerprint !== await fingerprint(db,tenantId,date);
  return { closed: !needsReview, needsReview, lastClose: { closingBalance: saved.closingBalance, note: review.note, reviewedAt: review.reviewedAt ?? saved.createdAt.toISOString() } };
}
async function dayWithinTx(db: Db, tenantId: string, date: Date) {
  const from=dayStart(date), to=dayEnd(date);
  const [entries,opening,state] = await Promise.all([
    db.dayBookEntry.findMany({ where: { tenantId, entryDate: { gte: from, lte: to } }, orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    openingBalance(db,tenantId,from), closingState(db,tenantId,from),
  ]);
  const cashIn=round(entries.filter(e=>e.type === "CASH_IN").reduce((sum,e)=>sum+n(e.amount),0));
  const cashOut=round(entries.filter(e=>e.type === "CASH_OUT").reduce((sum,e)=>sum+n(e.amount),0));
  return { date: from, opening, cashIn, cashOut, closing: round(opening+cashIn-cashOut), entries, ...state };
}
export function computeDayBookDay(tenantId: string, date: Date) {
  return prisma.$transaction(tx=>dayWithinTx(tx,tenantId,date),{isolationLevel:"RepeatableRead"});
}
export async function computeDayBookPeriod(tenantId: string, q: { fyCode?: string; from?: Date; to?: Date; page?: number; limit?: number }) {
  return prisma.$transaction(async db=>{
    const fy=await db.financialYear.findFirst({where:{tenantId,...(q.fyCode ? {code:q.fyCode}:{isActive:true})}});
    if(q.fyCode&&!fy) throw badRequest("Financial year not found");
    if(!q.from&&!fy) throw badRequest("Set an active financial year or choose a from date");
    const from=dayStart(q.from??fy!.startDate),to=dayEnd(q.to??indiaToday());
    if(to<from) throw badRequest("To date must be on/after from date");
    const page=q.page??1,limit=q.limit??20;
    const where={tenantId,...(fy?{fyCode:fy.code}:{}),entryDate:{gte:from,lte:to}};
    const [entries,total,sums,opening,state]=await Promise.all([
      db.dayBookEntry.findMany({where,orderBy:[{entryDate:"asc"},{createdAt:"asc"},{id:"asc"}],skip:(page-1)*limit,take:limit}),
      db.dayBookEntry.count({where}),db.dayBookEntry.groupBy({by:["type"],where,_sum:{amount:true}}),openingBalance(db,tenantId,from),
      dayStart(from).getTime()===dayStart(to).getTime()?closingState(db,tenantId,from):Promise.resolve({closed:false,needsReview:false,lastClose:null}),
    ]);
    const cashIn=n(sums.find(r=>r.type==="CASH_IN")?._sum.amount),cashOut=n(sums.find(r=>r.type==="CASH_OUT")?._sum.amount);
    return {from,to,fyCode:fy?.code,opening,cashIn,cashOut,closing:round(opening+cashIn-cashOut),entries,total,page,limit,...state};
  },{isolationLevel:"RepeatableRead"});
}
export async function saveDayBookClosing(tenantId: string, actorId: string, date: Date, note: string, now = new Date()) {
  if(dayStart(date)>indiaToday(now)) throw badRequest("Cannot close a future day");
  if(note.trim().length<5||note.length>500) throw badRequest("Enter a closing note of 5–500 characters");
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const fy=await tx.financialYear.findFirst({where:{tenantId,startDate:{lte:dayStart(date)},endDate:{gte:dayStart(date)}}});
    if(!fy) throw badRequest("Financial year not found for this date");
    const day=await dayWithinTx(tx,tenantId,date);
    const key={tenantId,group,key:day.date.toISOString().slice(0,10)};
    const before=await tx.setting.findUnique({where:{tenantId_group_key:key}});
    const metadata={fingerprint:await fingerprint(tx,tenantId,date),note:note.trim(),reviewedAt:now.toISOString(),reviewedBy:actorId};
    const balances={openingBalance:new Prisma.Decimal(day.opening),totalCashIn:new Prisma.Decimal(day.cashIn),totalCashOut:new Prisma.Decimal(day.cashOut),closingBalance:new Prisma.Decimal(day.closing),closedById:actorId};
    const saved=await tx.dayBookClosing.upsert({where:{tenantId_closingDate:{tenantId,closingDate:day.date}},create:{tenantId,closingDate:day.date,...balances},update:balances});
    await tx.setting.upsert({where:{tenantId_group_key:key},create:{...key,value:JSON.stringify(metadata),isSecret:false},update:{value:JSON.stringify(metadata)}});
    await tx.auditLog.create({data:{tenantId,userId:actorId,action:before?"DAYBOOK_CLOSING_REVIEWED":"DAYBOOK_CLOSED",entity:"DayBookClosing",entityId:saved.id,before:before?JSON.parse(before.value):undefined,after:{...metadata,opening:day.opening,receipts:day.cashIn,payments:day.cashOut,closing:day.closing}}});
    return saved;
  },{isolationLevel:"RepeatableRead",timeout:30000});
}
