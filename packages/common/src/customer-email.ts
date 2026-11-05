import { z } from "zod";

/** Additional billing recipients never change the customer's portal identity. */
export function customerMailRecipients(customer: { email?: string | null; additionalEmails?: string[] }, companyEmail?: string | null): string {
  const valid=(value:string)=>z.string().email().safeParse(value).success;
  const recipients=[...new Set([customer.email, ...(customer.additionalEmails ?? [])].filter((value): value is string => !!value && !/[\r\n]/.test(value)).flatMap(value=>value.split(/[,;]/)).map((value) => value.trim().toLowerCase()).filter(valid))];
  const fallback=companyEmail?.trim().toLowerCase();
  return recipients.length ? recipients.join(", ") : fallback && valid(fallback) ? fallback : "";
}

/** Copy the tenant company once; customer recipients remain in To. */
export function companyMailCc(companyEmail:string|null|undefined,to:string):string|undefined {
  const email=companyEmail?.trim().toLowerCase();
  if(!email||!z.string().email().safeParse(email).success)return undefined;
  const recipients=to.split(/[,;]/).map(value=>value.trim().toLowerCase());
  return recipients.includes(email)?undefined:email;
}
