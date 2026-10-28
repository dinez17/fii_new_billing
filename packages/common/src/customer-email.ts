/** Additional billing recipients never change the customer's portal identity. */
export function customerMailRecipients(customer: { email?: string | null; additionalEmails?: string[] }): string {
  return [...new Set([customer.email, ...(customer.additionalEmails ?? [])].filter((value): value is string => !!value).map((value) => value.trim().toLowerCase()))].join(", ");
}
