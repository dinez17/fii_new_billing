import {useQuery} from "@tanstack/react-query";
import {api,errMessage} from "../lib/api";
export function MoneyAccountSelect({value,onChange,label="Cash / bank account",required=false,mode}:{value:string;onChange:(id:string)=>void;label?:string;required?:boolean;mode?:string}){
 const accounts=useQuery({queryKey:["money-accounts"],queryFn:async()=>(await api.get("/financial-controls/money-accounts")).data as Array<{id:string;name:string;code:string}>});
 const visible=accounts.data?.filter(a=>!mode||(mode==="CASH"?a.code==="SYS_CASH":a.code!=="SYS_CASH"&&a.code!=="SYS_BANK_UNASSIGNED"));
 return <label>{label}{required?" *":""}<select required={required} aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">Select account</option>{visible?.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>{accounts.isSuccess&&visible?.length===0&&<small>No {mode==="CASH"?"cash":"bank"} account is available. Configure it in Settings.</small>}{accounts.isError&&<small className="error">{errMessage(accounts.error)}</small>}</label>;
}
