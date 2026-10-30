import { z } from "zod";
import { transactionPeriodFilters } from "@fii/common";

export const lineItem = z.object({
  // nullish: invoice items loaded from the API carry null for these fields
  productId: z.string().uuid().nullish(), // linked product → stock OUT for goods
  description: z.string().min(1).max(300),
  hsnSac: z.string().max(10).nullish(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  gstRate: z.coerce.number().min(0).max(28),
});

export const invoiceCreateBody = z.object({
  chargeGst: z.boolean().optional(),
  poNumber: z.string().trim().max(100).nullable().optional(),
  customerId: z.string().uuid(),
  subscriberId: z.string().uuid().optional(),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  items: z.array(lineItem).min(1).max(50),
  notes: z.string().max(1000).optional(),
  terms: z.string().max(2000).optional(),
}).refine((b) => b.dueDate >= b.invoiceDate, { message: "dueDate must be on/after invoiceDate" });

export const invoiceUpdateBody = z.object({
  chargeGst: z.boolean().optional(),
  customerId: z.string().uuid().optional(),
  subscriberId: z.string().uuid().nullable().optional(),
  invoiceDate: z.coerce.date().optional(),
  poNumber: z.string().trim().max(100).nullable().optional(),
  dueDate: z.coerce.date().optional(),
  items: z.array(lineItem).min(1).max(50).optional(),
  notes: z.string().max(1000).optional(),
  terms: z.string().max(2000).optional(),
});

export const cancelBody = z.object({ reason: z.string().min(3).max(300) });

export const invoiceListQuery = z.object({
  taxMode: z.enum(["GST", "WITHOUT_GST"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["OUTSTANDING", "DRAFT", "UNPAID", "PARTIAL", "PAID", "CANCELLED"]).optional(),
  customerId: z.string().uuid().optional(),
  fyCode: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.preprocess((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value, z.coerce.date().optional()),
});

export const noteCreateBody = z.object({
  invoiceId: z.string().uuid(),
  noteDate: z.coerce.date(),
  reason: z.string().min(3).max(300),
  items: z.array(lineItem).min(1).max(50),
});

export const noteListQuery = z.object({
  ...transactionPeriodFilters,
  status: z.enum(["ISSUED", "ADJUSTED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});
