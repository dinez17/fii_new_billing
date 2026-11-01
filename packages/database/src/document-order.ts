import {Prisma} from "@prisma/client";
import {prisma} from "./client.js";
const documents={
 INVOICE:{table:"Invoice",number:"invoiceNumber",date:"invoiceDate",party:"Customer",partyId:"customerId",search:["invoiceNumber","poNumber"]},
 PURCHASE:{table:"PurchaseInvoice",number:"ourNumber",date:"invoiceDate",party:"Supplier",partyId:"supplierId",search:["ourNumber","billNumber"]},
 QUOTATION:{table:"SalesDocument",number:"documentNumber",date:"documentDate",party:"Customer",partyId:"customerId",search:["documentNumber","subject"]},
 CREDIT_NOTE:{table:"CreditNote",number:"noteNumber",date:"noteDate",party:null,partyId:"customerId",search:["noteNumber"]},
 DEBIT_NOTE:{table:"DebitNote",number:"noteNumber",date:"noteDate",party:null,partyId:"customerId",search:["noteNumber"]},
} as const;
type DocumentKind=keyof typeof documents;
interface Filters {tenantId:string;fyCode?:string;customerId?:string;supplierId?:string;from?:Date;to?:Date;search?:string;statuses?:string[];excludeStatuses?:string[];chargeGst?:boolean;documentKind?:string;limit:number;page?:number}
/** Sort before LIMIT/OFFSET, including unpadded imported document numbers. */
export async function numberedDocumentIds(kind:DocumentKind,q:Filters){
 const c=documents[kind],field=(name:string)=>Prisma.raw('d."'+name+'"'),conditions=[Prisma.sql`d."tenantId"=${q.tenantId}`];
 if(q.fyCode)conditions.push(Prisma.sql`d."fyCode"=${q.fyCode}`);
 if(q.customerId)conditions.push(Prisma.sql`d."customerId"=${q.customerId}`);
 if(q.supplierId)conditions.push(Prisma.sql`d."supplierId"=${q.supplierId}`);
 if(q.from)conditions.push(Prisma.sql`${field(c.date)}>=${q.from}`);
 if(q.to)conditions.push(Prisma.sql`${field(c.date)}<=${q.to}`);
 if(q.statuses?.length)conditions.push(Prisma.sql`d.status::text IN (${Prisma.join(q.statuses)})`);
 if(q.excludeStatuses?.length)conditions.push(Prisma.sql`d.status::text NOT IN (${Prisma.join(q.excludeStatuses)})`);
 if(q.chargeGst!==undefined)conditions.push(Prisma.sql`d."chargeGst"=${q.chargeGst}`);
 if(q.documentKind)conditions.push(Prisma.sql`d.kind=${q.documentKind}`);
 if(q.search){const pattern='%'+q.search+'%',search:Prisma.Sql[]=c.search.map(name=>Prisma.sql`${field(name)} ILIKE ${pattern}`);
  if(c.party)search.push(Prisma.sql`EXISTS(SELECT 1 FROM ${Prisma.raw('"'+c.party+'"')} p WHERE p.id=${field(c.partyId)} AND p."tenantId"=${q.tenantId} AND p.name ILIKE ${pattern})`);
  conditions.push(Prisma.sql`(${Prisma.join(search,' OR ')})`);
 }
 const rows=await prisma.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT d.id FROM ${Prisma.raw('"'+c.table+'"')} d WHERE ${Prisma.join(conditions,' AND ')} ORDER BY ${field(c.date)} DESC,COALESCE(substring(${field(c.number)} FROM '[0-9]+$')::numeric,0) DESC,${field(c.number)} DESC,d.id DESC LIMIT ${q.limit} OFFSET ${((q.page??1)-1)*q.limit}`);
 return rows.map(r=>r.id);
}
export function inDocumentOrder<T extends {id:string}>(rows:T[],ids:string[]):T[]{const ranks=new Map(ids.map((id,i)=>[id,i]));return rows.sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity));}
