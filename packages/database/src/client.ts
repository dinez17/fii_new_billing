import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __fiiPrisma: PrismaClient | undefined;
}

/** Singleton base client (no tenant scope). Workers/system jobs use this. */
export const prisma: PrismaClient =
  globalThis.__fiiPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["warn", "error"] : ["warn", "error", "info"],
  });

if (process.env.NODE_ENV !== "production") globalThis.__fiiPrisma = prisma;
