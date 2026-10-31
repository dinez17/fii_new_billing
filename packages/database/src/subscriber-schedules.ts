import {Prisma} from "@prisma/client";
export const businessToday=()=>new Date(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));
const transitions:Record<string,string[]>={ACTIVE:["SUSPENDED","TERMINATED"],SUSPENDED:["ACTIVE","TERMINATED"],TERMINATED:[]};
export const scheduleTarget=(action:string)=>({PAUSE:"SUSPENDED",RESUME:"ACTIVE",TERMINATE:"TERMINATED"} as Record<string,string>)[action];
export async function applySubscriberSchedules(tx:Prisma.TransactionClient,tenantId:string,today=businessToday()){
 const rows=await tx.subscriberSchedule.findMany({where:{tenantId,status:"PENDING",effectiveDate:{lte:today}},orderBy:[{effectiveDate:"asc"},{id:"asc"}],take:500});let applied=0;
 for(const row of rows){await tx.$queryRaw`SELECT id FROM "Subscriber" WHERE "tenantId"=${tenantId} AND id=${row.subscriberId} FOR UPDATE`;const pending=await tx.subscriberSchedule.findFirst({where:{id:row.id,tenantId,status:"PENDING"}});if(!pending)continue;const sub=await tx.subscriber.findFirst({where:{id:row.subscriberId,tenantId}}),target=scheduleTarget(row.action);if(!sub||!target||!transitions[sub.status].includes(target)){await tx.subscriberSchedule.update({where:{id:row.id},data:{status:"FAILED",error:"Saved status no longer permits this transition",processedAt:new Date()}});continue;}
  if(target==="TERMINATED"){const mappings=await tx.subscriberPlan.findMany({where:{tenantId,subscriberId:sub.id,endDate:null}});for(const m of mappings)await tx.subscriberPlan.update({where:{id:m.id},data:{endDate:m.startDate>row.effectiveDate?m.startDate:row.effectiveDate}});}
  await tx.subscriber.update({where:{id:sub.id},data:{status:target as any,...(target==="TERMINATED"?{deactivationDate:row.effectiveDate}:{})}});await tx.subscriberSchedule.update({where:{id:row.id},data:{status:"APPLIED",processedAt:new Date()}});await tx.auditLog.create({data:{tenantId,userId:row.createdById,action:"SUBSCRIBER_SCHEDULE_APPLIED",entity:"Subscriber",entityId:sub.id,before:{status:sub.status},after:{status:target,effectiveDate:row.effectiveDate.toISOString(),note:row.note}}});applied++;
 }
 return applied;
}

/** Pending lifecycle changes are projected only forward from today's saved status. */
export function plannedSubscriberStatus(status:string,schedules:Array<{status:string;action:string;effectiveDate:Date}>,at:Date){
 return schedules.filter(s=>s.status==="PENDING"&&s.effectiveDate<=at).sort((a,b)=>a.effectiveDate.getTime()-b.effectiveDate.getTime()).reduce((value,s)=>scheduleTarget(s.action)??value,status);
}
