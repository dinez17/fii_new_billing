import { z } from "zod";
export const transactionPeriodFilters = {
  fyCode: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.preprocess((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value, z.coerce.date().optional()),
};
