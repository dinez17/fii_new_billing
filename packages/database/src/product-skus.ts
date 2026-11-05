import type {Prisma} from "@prisma/client";
const group="PRODUCT_NUMBERING",key="nextNumber";
/** All product creators share this tenant lock and durable counter. */
export async function allocateProductSku(tx:Prisma.TransactionClient,tenantId:string):Promise<string>{
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId} FOR UPDATE`;
 const [setting,products]=await Promise.all([tx.setting.findUnique({where:{tenantId_group_key:{tenantId,group,key}}}),tx.product.findMany({where:{tenantId},select:{sku:true}})]);
 const max=products.reduce((n,p)=>/^[0-9]{6}$/.test(p.sku)?Math.max(n,Number(p.sku)):n,0);
 const next=Math.max(1,max+1,Number(setting?.value)||1);
 if(!Number.isSafeInteger(next)||next>999999)throw new Error("Six-digit product SKU sequence is exhausted");
 await tx.setting.upsert({where:{tenantId_group_key:{tenantId,group,key}},create:{tenantId,group,key,value:String(next+1)},update:{value:String(next+1)}});
 return String(next).padStart(6,"0");
}
/** Convert legacy display codes only; retain product IDs, prices, stock and links. */
export async function convertProductSkus(tx:Prisma.TransactionClient,tenantId:string){
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId} FOR UPDATE`;
 const products=await tx.product.findMany({where:{tenantId},orderBy:[{createdAt:"asc"},{id:"asc"}]});
 const changes=[];
 for(const p of products){
  if(/^[0-9]{6}$/.test(p.sku)&&Number(p.sku)>0)continue;
  const sku=await allocateProductSku(tx,tenantId);
  await tx.product.update({where:{id:p.id},data:{sku}});changes.push({id:p.id,oldSku:p.sku,newSku:sku});
 }
 return changes;
}
