import type { Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { badRequest } from "@fii/common";

/** async handler wrapper — forwards rejections to the error middleware */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

export const n = (v: unknown): number => Number(v ?? 0);
export const money = (v: unknown): number => Math.round(n(v) * 100) / 100;

/** UTC day boundaries for an inclusive [from, to] date range. */
export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
export const dayEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

export const dateRange = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((v) => v.to >= v.from, { message: "to must be on/after from" });
