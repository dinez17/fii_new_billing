import {useEffect,useState} from "react";
import {api,errMessage} from "../../lib/api";

export interface PurchaseExtraction {
 pricesIncludeGst?:boolean;requiresTotalMatch?:boolean;inferredServiceQuantity?:boolean;supplierId:string;supplierName:string;billNumber:string;invoiceDate:string;dueDate:string;
 taxRounding?:"PAISE"|"WHOLE_RUPEE";expectedTotal:number|null;roundOff:number|null;sourceText:string;warnings:string[];duplicate:string|null;
 items:{productId:string;description:string;hsnSac?:string;unit?:string;sourceLineTotal?:number;quantity:number;unitPrice:number;discount:number;gstRate:number}[];
}
export interface PurchaseSource {fileName:string;dataUrl:string}
export function PurchaseUpload({onExtract,onClear,onBusyChange}:{onBusyChange:(busy:boolean)=>void;onExtract:(draft:PurchaseExtraction,source:PurchaseSource)=>void;onClear:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[preview,setPreview]=useState("");
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 async function extract(file:File){
  setError("");
  if(!["application/pdf","image/png","image/jpeg"].includes(file.type)||file.size>5*1024*1024){setError("Choose a PDF, PNG or JPG file up to 5 MB.");return;}
  setBusy(true);onBusyChange(true);onClear();setPreview("");
  try{
   const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Could not read file"));reader.readAsDataURL(file);});
   const source={fileName:file.name,dataUrl};
   const {data}=await api.post<PurchaseExtraction>("/purchase-invoices/extract",source,{timeout:180_000});
   onExtract(data,source);setPreview(URL.createObjectURL(file));
  }catch(err){setError(errMessage(err));}finally{setBusy(false);onBusyChange(false);}
 }
 return <section className="card" aria-labelledby="purchase-upload-title">
  <h3 id="purchase-upload-title">Upload supplier invoice</h3>
  <p className="document-help">Upload → review the draft → save. PDF, PNG or JPG · up to 5 MB and 4 pages. Clear English documents work best. No stock or accounting entries are created during extraction.</p>
  <label htmlFor="purchase-file">Choose invoice PDF or image</label>
  <input id="purchase-file" type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void extract(file);e.target.value="";}}/>
  {busy&&<p role="status">Reading invoice… Scanned documents can take up to two minutes.</p>}
  {preview&&<p><a href={preview} target="_blank" rel="noopener noreferrer">Open original invoice for review</a></p>}
  {error&&<div className="error" role="alert">{error}</div>}
 </section>;
}
