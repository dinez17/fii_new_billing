/** WhatsApp destination in international digits; plain 10-digit numbers default to India. */
export function normalizeWhatsappPhone(value:string|null|undefined):string|null {
 const input=value?.trim();if(!input)return null;
 if(!/^\+?[\d\s()-]+$/.test(input))return null;
 let digits=input.replace(/\D/g,"");
 if(!input.startsWith("+")&&digits.length===10)digits="91"+digits;
 return /^[1-9]\d{7,14}$/.test(digits)?digits:null;
}
