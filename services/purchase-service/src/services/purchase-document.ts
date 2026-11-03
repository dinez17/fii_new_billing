import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {z} from "zod";
import {badRequest,decryptSecret,computePurchaseGst} from "@fii/common";
import {prisma} from "@fii/database";

export const sourceDocumentBody=z.object({fileName:z.string().min(1).max(180),dataUrl:z.string().max(7_100_000),reviewed:z.literal(true).optional()});
export function decodePurchaseDocument(input:z.infer<typeof sourceDocumentBody>){
 const match=/^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);
 if(!match)throw badRequest("Choose a PDF, PNG or JPG invoice");
 const bytes=Buffer.from(match[2],"base64"),mimeType=match[1];
 if(!bytes.length||bytes.length>5*1024*1024||bytes.toString("base64")!==match[2])throw badRequest("Invoice must be a valid file of 5 MB or smaller");
 const valid=mimeType==="application/pdf"?bytes.subarray(0,5).toString()==="%PDF-":mimeType==="image/png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!valid)throw badRequest("File contents do not match its format");
 return {bytes,mimeType,base64:match[2],fileName:[...input.fileName].map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||c==="/"||c===String.fromCharCode(92)?"_":c).join("").slice(0,180),hash:createHash("sha256").update(bytes).digest("hex")};
}

function invoiceDate(value:string){
 const m=/^(\d{1,2})[-/. ](\d{1,2}|[A-Za-z]{3,9})[-/. ](\d{2}|\d{4})$/.exec(value.trim());
 if(!m)return "";
 const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
 const month=/^\d+$/.test(m[2])?Number(m[2]):months.indexOf(m[2].slice(0,3).toLowerCase())+1;
 const year=Number(m[3])+(m[3].length===2?2000:0),day=Number(m[1]);
 const d=new Date(Date.UTC(year,month-1,day));
 return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`:"";
}
const numeric=(s:string)=>{const match=/^([-+]?\d+(?:\.\d+)?)(?:[A-Za-z]*)$/.exec(s.replace(/[₹,%\s]/g,""));return match?Number(match[1]):NaN;};
export function parseRateFirstPhoto(lines:string[]){
 const items:Array<{description:string;quantity:number;unitPrice:number;discount:number;gstRate:number;hsnSac:string;unit:string;sourceLineTotal:number}>=[];
 const warnings:string[]=[];let lastRow=-1;
 const pattern=/^(?:\d{1,3}[.)]?|:)\s+([\d,]+(?:\.\d+)?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(Nos?|PCS?|Units?|Mtrs?|Meters?|Kg)\s+([\d,]+\.\d{2})\s*$/i;
 for(let index=0;index<lines.length;index++){
  const row=pattern.exec(lines[index]);
  if(row){
   const unitPrice=numeric(row[1]),quantity=numeric(row[3]),sourceLineTotal=numeric(row[5]);
   if(!(quantity>0)||!Number.isFinite(unitPrice))continue;
   items.push({description:row[2],unitPrice,quantity,discount:0,gstRate:-1,hsnSac:"",unit:/^nos?$/i.test(row[4])?"NOS":row[4].toUpperCase(),sourceLineTotal});lastRow=index;
   if(Math.abs(unitPrice*quantity-sourceLineTotal)>0.02)warnings.push(`Item ${items.length}: quantity × rate differs from the printed line amount. Check the original image.`);
   if(items.length===100)break;
  }else if(items.length&&index===lastRow+1&&/^[A-Za-z][A-Za-z0-9 +()./-]{2,60}$/.test(lines[index])&&!/total|GST|invoice/i.test(lines[index])){
   items[items.length-1].description+=" "+lines[index];lastRow=index;
  }
 }
 // Tamil/corrupted total labels can be unreadable; retain the footer amount for review.
 const footer=items.length?lines.slice(lastRow+1).flatMap(line=>{const m=/(?:^|\s|:)\s*([\d,]+\.\d{2})\s*$/.exec(line);return m?[numeric(m[1])]:[];}):[];
 return {items,warnings,total:footer.length?Math.max(...footer):null};
}

export function parsePurchaseText(source:string){
 const text=source.replace(/\r/g,"").slice(0,100_000),lines=text.split("\n").map(s=>s.trim()).filter(Boolean);
 const rawLines=text.split("\n");
 const datePattern="(\\d{1,2}[-/. ](?:\\d{1,2}|[A-Za-z]{3,9})[-/. ](?:\\d{4}|\\d{2}))";
 function labeledValue(pattern:RegExp,parse:(value:string)=>string){
  for(let i=0;i<rawLines.length;i++){
   const match=pattern.exec(rawLines[i]);if(!match)continue;
   const inline=parse(rawLines[i].slice(match.index+match[0].length).trim());if(inline)return inline;
   // In boxed invoices the next row contains values under the label columns.
   if(i+1<rawLines.length){const below=parse(rawLines[i+1].slice(match.index).trim());if(below)return below;}
  }
  return "";
 }
 let billNumber=labeledValue(/(?:invoice|bill)\s*(?:no\.?|number|#)\s*[:#-]?\s*/i,value=>{
  const candidate=value.split(/\s{2,}/)[0];
  const number=/^[A-Za-z0-9][A-Za-z0-9/_. -]{1,49}$/.test(candidate)?candidate:"";
  return /\d/.test(number)?number:"";
 });
 const dateFor=(label:string)=>labeledValue(new RegExp(label+"\\s*[:.-]?\\s*","i"),value=>invoiceDate(new RegExp("^"+datePattern).exec(value)?.[1]??""));
 const totalLabel="(?:grand\\s+total|net\\s+(?:amount|payable)|total\\s+(?:amount|payable)|invoice\\s+total|total)";
 const totalPattern=new RegExp("^"+totalLabel+"\\s*[:₹]?\\s*(?:INR|Rs\\.?)?\\s*([-+]?[\\d,]+(?:\\.\\d{1,2})?)\\s*$","i");
 const totalMatch=lines.map(line=>totalPattern.exec(line)).find(match=>match!==null);
 let expectedTotal=totalMatch?numeric(totalMatch[1]):null;
 const roundLine=lines.find(l=>/^round\s*(?:off|ing)/i.test(l));
 const roundMatch=roundLine?.match(/[-+]?\s*\d+\.\d{1,2}/);
 const items:Array<{description:string;quantity:number;unitPrice:number;discount:number;gstRate:number;hsnSac:string;unit?:string;sourceLineTotal?:number}> = [];
 const hsnRates=new Map<string,Set<number>>();
 for(const line of lines){
  const hsn=/^(\d{4,8})\s+/.exec(line)?.[1];
  const rates=[...line.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m=>Number(m[1]));
  if(hsn&&rates.length>0&&rates.length<=2){const rate=rates.reduce((sum,r)=>sum+r,0);if([0,5,12,18,28].includes(rate)){const known=hsnRates.get(hsn)??new Set<number>();known.add(rate);hsnRates.set(hsn,known);}}
 }
 let header:string[]=[],amountOnly=false;
 let inferredServiceQuantity=false;
 for(const line of lines){
  const cells=line.split(/\s{2,}|\s*\|\s*/).filter(Boolean);
  if(/description|particular/i.test(line)&&/hsn|sac/i.test(line)&&/amount/i.test(line)&&!/qty|quantity|rate|price/i.test(line)){amountOnly=true;header=[];continue;}
  if(amountOnly){
   if(/^(?:CGST|SGST|IGST|round\s*off|total|amount\s+charg)/i.test(line)){amountOnly=false;continue;}
   const row=/^\d+\s+(.+?)\s{2,}(\d{4,8})\s{2,}([\d,]+(?:\.\d{1,2})?)\s*$/.exec(line);
   if(row){const rates=hsnRates.get(row[2]);const gstRate=rates?.size===1?[...rates][0]:-1;items.push({description:row[1].slice(0,300),quantity:1,unitPrice:numeric(row[3]),discount:0,gstRate,hsnSac:row[2]});inferredServiceQuantity=true;}
   continue;
  }
  if(/description|particular|product\s*name|item\s*name/i.test(line)&&/qty|quantity/i.test(line)&&/rate|price/i.test(line)){const detected=line.match(/s\.?\s*no\.?|description(?:\s+of\s+(?:goods|services))?|particulars?|product\s*name|item\s*name|hsn\/sac|hsn|sac|quantity|qty|unit\s*price|rate|(?:gst|tax)\s*%|gst\s*rate|discount|disc\.?|amount|total/gi)??cells;header=detected.length>=cells.length?detected:cells;continue;}
  if(!header.length||cells.length!==header.length||/grand total|sub\s*total|^total\b/i.test(line))continue;
  const at=(pattern:RegExp)=>cells[header.findIndex(h=>pattern.test(h))]??"";
  const description=at(/description|particular|product\s*name|item\s*name/i),quantity=numeric(at(/qty|quantity/i)),unitPrice=numeric(at(/rate|price/i));
  const taxColumn=header.findIndex(h=>/(?:gst|tax).*%|gst\s*rate/i.test(h));
  const gstRate=taxColumn>=0?numeric(cells[taxColumn]):NaN;
  if(description&&quantity>0&&Number.isFinite(unitPrice)&&unitPrice>=0)items.push({description:description.slice(0,300),quantity,unitPrice,discount:numeric(at(/disc/i))||0,gstRate:[0,5,12,18,28].includes(gstRate)?gstRate:-1,hsnSac:at(/hsn|sac/i)});
  if(items.length>=100)break;
 }
 const photographed=parseRateFirstPhoto(lines);
 const photoFormat=items.length===0&&photographed.items.length>=2;
 if(photoFormat){
  items.push(...photographed.items);
  if(!billNumber)billNumber=labeledValue(/^No\s*[:.-]\s*/i,value=>value.split(/\s{2,}/)[0].trim());
  if(expectedTotal===null)expectedTotal=photographed.total;
 }
 // Some service invoices place explicit tax rates beside ADD: Output CGST/SGST.
 const taxComponents=(["CGST","SGST","IGST"] as const).flatMap(kind=>{
  const line=lines.find(l=>new RegExp("^(?:ADD\\s*:\\s*)?(?:Output\\s*)?"+kind+"\\s*@\\s*\\d","i").test(l));
  if(!line)return [];
  const rate=new RegExp(kind+"\\s*@\\s*(\\d+(?:\\.\\d+)?)%","i").exec(line),amount=/\s{2,}([\d,]+(?:\.\d{1,2})?)\s*$/.exec(line);
  return rate&&amount?[{kind,rate:Number(rate[1]),amount:numeric(amount[1])}]:[];
 });
 if(new Set(items.map(i=>i.hsnSac)).size===1){
  const kinds=taxComponents.map(t=>t.kind),rate=taxComponents.reduce((sum,t)=>sum+t.rate,0);
  if((kinds.join(",")==="CGST,SGST"||kinds.join(",")==="IGST")&&[0,5,12,18,28].includes(rate))for(const item of items)if(item.gstRate<0)item.gstRate=rate;
 }
 let taxRounding:"PAISE"|"WHOLE_RUPEE"="PAISE";
 if(items.length&&items.every(i=>i.gstRate>=0)&&taxComponents.length){
  const interState=taxComponents.some(t=>t.kind==="IGST"),normal=computePurchaseGst(items,interState),whole=computePurchaseGst(items,interState,"WHOLE_RUPEE");
  const matches=(totals:typeof normal)=>taxComponents.every(t=>Math.abs(Number(totals[t.kind.toLowerCase() as "cgst"|"sgst"|"igst"])-t.amount)<0.005);
  if(!matches(normal)&&matches(whole))taxRounding="WHOLE_RUPEE";
 }
 const invoiceDay=(photoFormat?dateFor("(?:invoice\\s*date|bill\\s*date|dated|date)"):"")||dateFor("(?:invoice\\s*date|bill\\s*date|dated)");
 const dueLabel="(?:payment\\s+)?due\\s*(?:date|on)";
 const explicitDue=dateFor(dueLabel);
 const monthlyDue=invoiceDay?labeledValue(new RegExp(dueLabel+"\\s*[:.-]?\\s*","i"),value=>{
  const day=/^(\d{1,2})(?:st|nd|rd|th)\s+of\s+every\s+month\b/i.exec(value)?.[1];
  if(!day)return "";const candidate=invoiceDate(`${day}-${invoiceDay.slice(5,7)}-${invoiceDay.slice(0,4)}`);return candidate>=invoiceDay?candidate:"";
 }):"";
 const signer=lines.map(l=>/\bfor\s+([A-Za-z][A-Za-z0-9 &.,-]+?(?:PVT\s+LTD|PRIVATE\s+LIMITED|LIMITED|LTD))(?:\s|$)/i.exec(l)?.[1]).find(Boolean);

 return {pricesIncludeGst:photoFormat,requiresTotalMatch:photoFormat,extractionWarnings:photoFormat?[...photographed.warnings,"No separate GST rate is shown. Confirm the GST treatment before saving."]:[],taxRounding,inferredServiceQuantity,supplierName:(photoFormat?lines.find(l=>/^[A-Za-z][A-Za-z .&-]{3,}$/.test(l)&&!/invoice/i.test(l))?.replace(/\s+/g," "):undefined)??signer??lines.find(l=>!/^tax invoice|^invoice|^original|^duplicate/i.test(l))?.split(/\s{2,}/)[0].slice(0,150)??"",gstins:[...new Set(text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g)??[])],billNumber,invoiceDate:invoiceDay,dueDate:explicitDue||monthlyDue,roundOff:roundMatch?numeric(roundMatch[0]):null,expectedTotal,items,sourceText:text};
}

const execute=promisify(execFile);
let active=0;
export async function extractDocumentText(bytes:Buffer,mimeType:string){
 if(active>=2)throw badRequest("Invoice extraction is busy. Try again shortly.");
 active++;
 let dir:string|undefined;
 const deadline=Date.now()+120_000;
 const run=async(tool:string,args:string[])=>{const remaining=deadline-Date.now();if(remaining<=0)throw badRequest("Extraction timed out. Upload a smaller, clearer invoice.");return String((await execute(tool,args,{timeout:Math.min(30_000,remaining),maxBuffer:1_000_000,env:{...process.env,OMP_THREAD_LIMIT:"1"}})).stdout);};
 try{
  dir=await mkdtemp(join(tmpdir(),"vaniga-purchase-"));
  const path=join(dir,mimeType==="application/pdf"?"invoice.pdf":mimeType==="image/png"?"invoice.png":"invoice.jpg");
  await writeFile(path,bytes,{mode:0o600});
  if(mimeType!=="application/pdf"){
   const normal=await run("tesseract",[path,"stdout","-l","eng","-c","preserve_interword_spaces=1"]);
   if(parseRateFirstPhoto(normal.split("\n").map(l=>l.trim()).filter(Boolean)).items.length<2)return normal;
   const uniform=await run("tesseract",[path,"stdout","-l","eng","--psm","6","-c","preserve_interword_spaces=1"]);
   const score=(value:string)=>{const result=parseRateFirstPhoto(value.split("\n").map(l=>l.trim()).filter(Boolean));return result.items.length*10-result.warnings.length*3;};
   return score(uniform)>score(normal)?uniform:normal;
  }
  const info=await run("pdfinfo",[path]);const pages=Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  if(!pages||pages>4)throw badRequest("Upload an invoice with no more than 4 pages");
  let text=await run("pdftotext",["-layout","-enc","UTF-8",path,"-"]);
  if(text.replace(/\s/g,"").length>=80)return text;
  text="";
  for(let page=1;page<=pages;page++){
   const image=join(dir,"page");
   await run("pdftoppm",["-f",String(page),"-l",String(page),"-scale-to","2200","-singlefile","-png",path,image]);
   text+=await run("tesseract",[image+".png","stdout","-l","eng","-c","preserve_interword_spaces=1"])+"\n";
  }
  return text;
 }catch(error){
  if(error instanceof Error&&"statusCode" in error)throw error;
  throw badRequest("Could not read the invoice. Use a clear, unencrypted PDF/JPG/PNG. Server OCR tools must be installed.");
 }finally{try{if(dir)await rm(dir,{recursive:true,force:true});}finally{active--;}}
}

const normal=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
export async function extractPurchaseDocument(tenantId:string,input:z.infer<typeof sourceDocumentBody>){
 const file=decodePurchaseDocument(input);
 const previous=await prisma.purchaseInvoice.findFirst({where:{tenantId,sourceDocumentHash:file.hash},select:{ourNumber:true,billNumber:true}});
 if(previous)throw badRequest(`This file is already attached to ${previous.ourNumber} (${previous.billNumber})`);
 const draft=parsePurchaseText(await extractDocumentText(file.bytes,file.mimeType));
 const [suppliers,products]=await Promise.all([prisma.supplier.findMany({where:{tenantId,isActive:true},select:{id:true,name:true,gstin:true}}),prisma.product.findMany({where:{tenantId,isActive:true},select:{id:true,name:true,sku:true}})]);
 const matches=suppliers.filter(s=>s.gstin&&draft.gstins.includes(s.gstin));
 const names=suppliers.filter(s=>normal(s.name).length>=5&&normal(draft.sourceText).includes(normal(s.name)));
 const candidates=matches.length?matches:names;
 const supplierId=candidates.length===1?candidates[0].id:"";
 const duplicate=supplierId&&draft.billNumber?await prisma.purchaseInvoice.findFirst({where:{tenantId,supplierId,billNumber:draft.billNumber},select:{ourNumber:true}}):null;
 const items=draft.items.map(item=>{const descriptions=[normal(item.description),normal(item.description.replace(/\s+(?:from|for)\s+\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}.*$/i,""))];const matches=products.filter(p=>descriptions.some(description=>normal(p.name)===description||normal(p.sku)===description||(normal(p.name).length>=12&&description.endsWith(normal(p.name)))));return {...item,productId:matches.length===1?matches[0].id:""};});
 return {...draft,items,supplierId,duplicate:duplicate?.ourNumber??null,warnings:["Review all extracted values against the original before saving.",...draft.extractionWarnings,...(draft.taxRounding==="WHOLE_RUPEE"?["The supplier rounds each GST component to whole rupees. This rounding method is selected in the draft; verify it against the invoice."]:[]),...(draft.inferredServiceQuantity?["Amount-only service lines use quantity 1 and the taxable service amount as the rate. Verify these values and the HSN-summary GST rate."]:[]),...(draft.expectedTotal===null?["Document total could not be read reliably. Verify the total manually."]:[]),...(!draft.billNumber||!draft.invoiceDate?["Invoice number or date was not detected. Enter it from the original."]:[]),...(!supplierId?["Select or create the supplier; no unambiguous match was found."]:[]),...(!items.length?["No reliable item table found. Add the products using the extracted text and original file."]:[]),...(items.some(i=>!i.productId||i.gstRate<0)?["Select unmatched products and verify every GST rate."]:[])]};
}

export async function originalPurchaseDocument(tenantId:string,id:string){
 const bill=await prisma.purchaseInvoice.findFirst({where:{tenantId,id},select:{sourceDocumentEncrypted:true}});
 if(!bill?.sourceDocumentEncrypted)throw badRequest("Original document unavailable");
 const file=JSON.parse(decryptSecret(bill.sourceDocumentEncrypted)) as {fileName:string;mimeType:string;base64:string};
 return {...file,bytes:Buffer.from(file.base64,"base64")};
}
