import {useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {api,errMessage} from "../../lib/api";
export function SignatureUpload({value,canEdit}:{value?:string|null;canEdit:boolean}){
 const qc=useQueryClient(),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function upload(file:File){
  if(!["image/png","image/jpeg"].includes(file.type)||file.size>300_000){setError("Use a PNG or JPEG under 300 KB.");return;}
  setBusy(true);setError("");
  try{const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});await api.post("/settings/company/signature",{dataUrl});await qc.invalidateQueries({queryKey:["company"]});}catch(e){setError(errMessage(e));}finally{setBusy(false);}
 }
 async function remove(){if(!confirm("Remove the company seal and signature from future PDF downloads?"))return;setBusy(true);setError("");try{await api.delete("/settings/company/signature");await qc.invalidateQueries({queryKey:["company"]});}catch(e){setError(errMessage(e));}finally{setBusy(false);}}
 return <section style={{borderBottom:"1px solid var(--border)",paddingBottom:16,marginBottom:16}}>
  <h4>Company seal & authorised signature</h4>
  <p className="document-help">Upload one combined seal and signature image. Transparent PNG is recommended. This is a visual signature, not a certificate-based digital signature. Changes apply to newly generated PDFs, including existing invoices.</p>
  {value&&<img src={value} alt="Company seal and authorised signature" style={{maxWidth:240,maxHeight:120,objectFit:"contain",background:"white",display:"block",marginBottom:10}}/>}
  {canEdit&&<div style={{display:"flex",gap:10,flexWrap:"wrap"}}><label>Upload seal and signature (PNG/JPEG, max 300 KB)<input aria-label="Upload company seal and signature" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value="";}}/></label>{value&&<button className="small danger" disabled={busy} onClick={()=>void remove()}>Remove signature</button>}</div>}
  {busy&&<p role="status">Saving signature…</p>}{error&&<div className="error" role="alert">{error}</div>}
 </section>;
}
