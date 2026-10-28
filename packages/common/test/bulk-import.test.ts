import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { importRows } from "../src/bulk-import.js";
import { conflict } from "../src/errors.js";
import { parseCsv } from "../../../apps/admin-web/src/lib/csv.js";

describe("CSV imports", () => {
  it("preserves text identifiers and parses BOM, commas, quotes and multiline values", () => {
    expect(parseCsv('\uFEFFname,phone,stateCode,notes\r\n"A, B",09000000001,03,"He said ""hello""\nNext line"\r\n')).toEqual([
      { name: "A, B", phone: "09000000001", stateCode: "03", notes: 'He said "hello"\nNext line' },
    ]);
  });
  it("rejects malformed files rather than silently shifting columns", () => {
    for (const csv of ['name,name\nA,B', 'name,phone\nA', 'name\n"unfinished', 'name\n"good"bad']) {
      expect(() => parseCsv(csv)).toThrow();
    }
  });
  it("rejects empty and oversized imports", () => {
    expect(() => parseCsv("name\n")).toThrow("no data");
    expect(() => parseCsv("name\n" + "Product\n".repeat(1001))).toThrow("1,000");
  });
  it("validates every row without writes during preview", async () => {
    const create = vi.fn(async () => ({ id: "new-id" }));
    const result = await importRows({ dryRun: true, rows: [{ name: "Valid" }, { name: "X" }], schema: z.object({ name: z.string().min(2) }), validate: async () => {}, create });
    expect(result.results.map((row) => row.status)).toEqual(["ready", "error"]);
    expect(create).not.toHaveBeenCalled();
  });
  it("reports row errors and continues without importing duplicates", async () => {
    const create = vi.fn(async () => ({ id: "new-id" }));
    const result = await importRows({ dryRun: false, rows: [{ name: "Existing" }, { name: "New" }], schema: z.object({ name: z.string() }), validate: async (row) => { if (row.name === "Existing") throw conflict("Duplicate name"); }, create });
    expect(result.results).toEqual([{ row: 1, status: "error", message: "Duplicate name" }, { row: 2, status: "created", id: "new-id" }]);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("does not expose internal exceptions as row validation messages", async () => {
    await expect(importRows({ dryRun: false, rows: [{ name: "New" }], schema: z.object({ name: z.string() }), validate: async () => {}, create: async () => { throw new Error("database unavailable"); } })).rejects.toThrow("database unavailable");
  });
});
