import { z } from "zod";

export const partyListFilters = {
  activity: z.enum(["all", "active", "inactive"]).default("all"),
  balance: z.enum(["all", "due", "settled", "credit"]).default("all"),
  sortBy: z.enum(["name", "code", "invoiceCount", "outstanding", "createdAt", "status"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
};
