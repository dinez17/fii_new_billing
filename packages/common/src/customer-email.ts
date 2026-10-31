import { z } from "zod";

/** Additional billing recipients never change the customer's portal identity. */
export function customerMailRecipients(customer: { email?: string | null; additionalEmails?: string[] }): string {
  return [...new Set([customer.email, ...(customer.additionalEmails ?? [])].filter((value): value is string => !!value).map((value) => value.trim().toLowerCase()))].join(", ");
}

/** Copy the tenant company once; customer recipients remain in To. */
export function companyMailCc(companyEmail:string|null|undefined,to:string):string|undefined {
  const email=companyEmail?.trim().toLowerCase();
  if(!email||!z.string().email().safeParse(email).success)return undefined;
  const recipients=to.split(/[,;]/).map(value=>value.trim().toLowerCase());
  return recipients.includes(email)?undefined:email;
}
