import { z } from "zod";
import { AppError } from "./errors.js";

export const bulkImportBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
  dryRun: z.boolean().default(true),
});

export async function importRows<T>(options: {
  rows: Record<string, unknown>[];
  dryRun: boolean;
  schema: z.ZodType<T>;
  validate: (input: T) => Promise<void>;
  create: (input: T) => Promise<{ id: string }>;
}) {
  const results: { row: number; status: "ready" | "created" | "error"; id?: string; message?: string }[] = [];
  for (const [index, row] of options.rows.entries()) {
    const parsed = options.schema.safeParse(row);
    if (!parsed.success) {
      results.push({ row: index + 1, status: "error", message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
      continue;
    }
    try {
      await options.validate(parsed.data);
      if (options.dryRun) results.push({ row: index + 1, status: "ready" });
      else {
        const created = await options.create(parsed.data);
        results.push({ row: index + 1, status: "created", id: created.id });
      }
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      results.push({ row: index + 1, status: "error", message: error.message });
    }
  }
  return { results };
}
