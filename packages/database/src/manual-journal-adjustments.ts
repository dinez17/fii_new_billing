import {prisma} from "./client.js";
export async function manualJournalAdjustments(tenantId:string,from:Date|null,to:Date){
 const grouped=await prisma.journalLine.groupBy({by:["accountId"],where:{tenantId,journal:{tenantId,source:{in:["MANUAL","REVERSAL"]},entryDate:{...(from?{gte:from}:{}),lte:to}}},_sum:{debit:true,credit:true}});
 const accounts=await prisma.financialAccount.findMany({where:{tenantId,id:{in:grouped.map(g=>g.accountId)}}});
 return grouped.map(g=>({account:accounts.find(a=>a.id===g.accountId)!,debit:Number(g._sum.debit??0),credit:Number(g._sum.credit??0)}));
}
