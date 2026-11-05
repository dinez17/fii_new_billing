import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {prisma,allocateProductSku,convertProductSkus} from "../src/index.js";
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("tenant numeric product SKUs",()=>{
 let first:string,second:string;
 beforeAll(async()=>{const suffix=Date.now()+"-"+Math.random();first=(await prisma.tenant.create({data:{name:"SKU tenant A",subdomain:"sku-a-"+suffix}})).id;second=(await prisma.tenant.create({data:{name:"SKU tenant B",subdomain:"sku-b-"+suffix}})).id;});
 afterAll(async()=>{await prisma.product.deleteMany({where:{tenantId:{in:[first,second]}}});await prisma.setting.deleteMany({where:{tenantId:{in:[first,second]}}});await prisma.tenant.deleteMany({where:{id:{in:[first,second]}}});});
 const create=(tenantId:string)=>prisma.$transaction(async tx=>tx.product.create({data:{tenantId,name:"Auto",sku:await allocateProductSku(tx,tenantId)}}));
 it("allocates unique six-digit codes concurrently and isolates tenants",async()=>{const rows=await Promise.all(Array.from({length:4},()=>create(first)));expect(rows.map(r=>r.sku).sort()).toEqual(["000001","000002","000003","000004"]);expect((await create(second)).sku).toBe("000001");});
 it("does not reuse deleted codes and rolls back unused allocations",async()=>{await prisma.product.deleteMany({where:{tenantId:first,sku:"000004"}});expect((await create(first)).sku).toBe("000005");await expect(prisma.$transaction(async tx=>{await allocateProductSku(tx,first);throw Error("cancel");})).rejects.toThrow("cancel");expect((await create(first)).sku).toBe("000006");});
 it("converts legacy codes without changing product IDs, prices or stock and is repeatable",async()=>{
 const old=await prisma.product.create({data:{tenantId:second,name:"Legacy",sku:"PRD-00001",salePrice:100,purchasePrice:50,stockQty:12,hsnSac:"998316"}});
 const changes=await prisma.$transaction(tx=>convertProductSkus(tx,second));expect(changes).toEqual([{id:old.id,oldSku:"PRD-00001",newSku:"000002"}]);
 const updated=await prisma.product.findUniqueOrThrow({where:{id:old.id}});expect(updated).toMatchObject({id:old.id,sku:"000002",hsnSac:"998316"});expect(updated.salePrice.toString()).toBe("100");expect(updated.stockQty.toString()).toBe("12");expect(await prisma.$transaction(tx=>convertProductSkus(tx,second))).toEqual([]);expect((await create(second)).sku).toBe("000003");
 });
 it("respects higher existing six-digit SKUs",async()=>{await prisma.product.create({data:{tenantId:second,name:"Existing numeric",sku:"000900"}});expect((await create(second)).sku).toBe("000901");});
});
