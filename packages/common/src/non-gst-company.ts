import { z } from "zod";

const optional = (max: number) => z.string().trim().max(max).default("");
const image = z.string().max(400_000).refine(v => !v || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(v), "Use a PNG or JPEG image").default("");
export const nonGstCompanySchema = z.object({
  enabled: z.enum(["true", "false"]).default("false"),
  name: optional(120), legalName: optional(200),
  addressLine1: optional(200), addressLine2: optional(200), city: optional(80),
  stateCode: z.string().regex(/^$|^[0-9]{2}$/, "Use a two-digit state code").default(""),
  pincode: z.string().regex(/^$|^[0-9]{6}$/, "Use a six-digit pincode").default(""),
  phone: optional(15), email: z.string().trim().email().or(z.literal("")).default(""),
  pan: z.string().trim().toUpperCase().regex(/^$|^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN").default(""),
  bankName: optional(120), bankBranch: optional(120), bankAccountNo: optional(30), bankPayableAt: optional(120),
  bankIfsc: z.string().trim().toUpperCase().regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC").default(""),
  logoUrl: image, signatureUrl: image,
}).strict().superRefine((value, ctx) => {
  if (value.enabled === "true" && value.name.length < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Company name is required when the separate profile is enabled" });
});

export const NON_GST_COMPANY_FIELDS = ["name", "legalName", "addressLine1", "addressLine2", "city", "stateCode", "pincode", "phone", "email", "pan", "bankName", "bankBranch", "bankAccountNo", "bankPayableAt", "bankIfsc", "logoUrl", "signatureUrl"] as const;
