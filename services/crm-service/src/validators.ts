import { z } from "zod";
import { partyListFilters } from "@fii/common";

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});
export const customerListQuery = pagination.extend(partyListFilters);

export const customerBody = z.object({
  additionalEmails: z.array(z.string().trim().email()).max(10).optional(),
  stateName: z.string().trim().max(80).optional(),
  installationCity: z.string().trim().max(80).optional(),
  installationState: z.string().trim().max(80).optional(),
  installationStateCode: z.string().regex(/^[0-9]{2}$/).optional().or(z.literal("")),
  installationPincode: z.string().regex(/^[0-9]{6}$/).optional().or(z.literal("")),
  name: z.string().min(2).max(120),
  email: z.string().trim().email().nullable().optional().or(z.literal("")).transform((v) => v === undefined ? undefined : v || null),
  phone: z.string().regex(/^[0-9+\-\s]{10,15}$/, "invalid phone").nullable().optional().or(z.literal("")).transform((value) => value || null),
  altPhone: z.string().optional(),
  gstin: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  gstTreatment: z.enum(["B2B", "B2C", "EXPORT", "SEZ", "NIL"]).default("B2C"),
  billingAddress: z.string().max(500).optional(),
  serviceAddress: z.string().max(500).optional(),
  city: z.string().max(80).optional(),
  stateCode: z.string().regex(/^[0-9]{2}$/, "2-digit GST state code").optional(),
  pincode: z.string().regex(/^[0-9]{6}$/, "6-digit pincode").optional().or(z.literal("")).transform((v) => v || undefined),
  openingBalance: z.coerce.number().default(0),
  notes: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const portalAccessBody = z.object({
  enable: z.boolean(),
  password: z.string().min(8).max(72).optional(),
});

export const planBody = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_-]+$/i),
  description: z.string().max(500).optional(),
  price: z.coerce.number().positive(),
  gstRate: z.coerce.number().min(0).max(28).default(18),
  hsnSac: z.string().max(10).optional(),
  billingCycleMonths: z.coerce.number().int().min(1).max(12).default(1),
  planType: z.enum(["PREPAID", "POSTPAID"]).default("PREPAID"),
  isActive: z.boolean().optional(),
});

export const billingCycle = z.coerce.number().int()
  .refine((n) => [1, 3, 6, 12].includes(n), "must be 1, 3, 6 or 12 months");

export const subscriberCreateBody = z.object({
  poNumber: z.string().trim().max(100).nullable().optional().transform((value) => value || null),
  customerId: z.string().uuid(),
  subscriberType: z.enum(["PREPAID", "POSTPAID"]),
  billingCycleMonths: billingCycle.default(1),
  plans: z.array(z.object({
    planId: z.string().uuid(),
    priceOverride: z.coerce.number().positive().optional(),
  })).min(1).max(10),
  activationDate: z.coerce.date(),
  installAddress: z.string().max(500).optional(),
  meta: z.record(z.string(), z.string()).optional(),
}).superRefine((b, ctx) => {
  const ids = b.plans.map((p) => p.planId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate plans selected" });
  }
});

export const addPlanBody = z.object({
  planId: z.string().uuid(),
  startDate: z.coerce.date(),
  priceOverride: z.coerce.number().positive().optional(),
});

export const endPlanBody = z.object({ endDate: z.coerce.date() });

export const subscriberUpdateBody = z.object({
  subscriberType: z.enum(["PREPAID", "POSTPAID"]).optional(),
  poNumber: z.string().trim().max(100).nullable().transform((value) => value || null).optional(),
  installAddress: z.string().max(500).optional(),
  meta: z.record(z.string(), z.string()).optional(),
  billingCycleMonths: billingCycle.optional(),
});

export const planChangeBody = z.object({
  planId: z.string().uuid(),
  effectiveDate: z.coerce.date(),
  priceOverride: z.coerce.number().positive().optional(),
});

export const subscriberListQuery = pagination.extend({
  status: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED"]).optional(),
  subscriberType: z.enum(["PREPAID", "POSTPAID"]).optional(),
  customerId: z.string().uuid().optional(),
});
