import { z } from "zod";

// ── Shared DTO schemas (grow module-by-module; frontend imports these too)

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  search: z.string().optional(),
});
export type PaginationDto = z.infer<typeof paginationSchema>;

// ── Event payloads

export const invoiceCreatedPayload = z.object({
  invoiceDate: z.string().optional(),
  fyCode: z.string().optional(),
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  customerId: z.string().uuid(),
  grandTotal: z.string(),
  dueDate: z.string(),
});
export type InvoiceCreatedPayload = z.infer<typeof invoiceCreatedPayload>;

export const billingGeneratePayload = z.object({
  taxMode: z.enum(["ALL", "GST", "WITHOUT_GST"]).default("ALL"),
  cycleType: z.enum(["PREPAID", "POSTPAID"]),
  periodStart: z.string(),
  periodEnd: z.string(),
});
export type BillingGeneratePayload = z.infer<typeof billingGeneratePayload>;
