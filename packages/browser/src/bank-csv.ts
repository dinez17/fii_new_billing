export function parseCsv(text:string,delimiter=","):string[][] {
 const rows:string[][]=[];let row:string[]=[],field="",quoted=false;
 text=text.replace(/^\uFEFF/,"");
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
 else if(c==='"'){if(field.trim())throw Error("Unexpected quote in CSV field");quoted=true;}
 else if(c===delimiter){row.push(field);field="";}
 else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field="";}
 else field+=c;}
 if(quoted)throw Error("Unclosed quoted CSV field");row.push(field);if(row.some(v=>v.trim()))rows.push(row);
 return rows;
}
export function bankRows(rows:string[][],mapping:{date:number;reference:number;narration:number;debit:number;credit:number;dateFormat:string}) {
 const money=(value:string)=>{const s=(value??"").trim().replace(/,/g,"").replace(/^₹\s*/,"");if(!s)return 0;if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error("Amounts must be positive numbers with at most two decimal places");return Number(s);};
 return rows.slice(1).map((r,index)=>{try{let s=r[mapping.date]?.trim()??"";if(mapping.dateFormat!=="ISO"){const parts=s.split(/[-/]/);if(parts.length!==3)throw Error("Invalid date");s=parts[2]+"-"+parts[1].padStart(2,"0")+"-"+parts[0].padStart(2,"0");}if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(new Date(s).getTime())||new Date(s).toISOString().slice(0,10)!==s)throw Error("Invalid calendar date");const debit=money(r[mapping.debit]),credit=money(r[mapping.credit]);if((debit>0)===(credit>0))throw Error("Choose exactly one withdrawal or receipt amount");const reference=r[mapping.reference]?.trim();if(!reference)throw Error("Transaction reference is required");return {date:s,reference,narration:r[mapping.narration]?.trim()??"",debit,credit};}catch(e){throw Error("CSV row "+(index+2)+": "+(e as Error).message);}});
}
