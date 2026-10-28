import type { NextFunction, Request, Response } from "express";
import { prisma } from "@fii/database";
import { forbidden, unauthorized } from "@fii/common";
import { verifyAccessToken, type AccessTokenClaims } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

/** Verifies the Bearer token and attaches req.auth. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized("Missing bearer token"));
  try {
    req.auth = verifyAccessToken(header.slice(7));
    next();
  } catch {
    next(unauthorized("Invalid or expired token"));
  }
}

export async function permissionsForRoles(roleIds: string[]): Promise<Set<string>> {
  if (roleIds.length === 0) return new Set();
  const rows = await prisma.rolePermission.findMany({
    where: { roleId: { in: roleIds } },
    include: { permission: true },
  });
  return new Set(rows.map((r) => `${r.permission.module}:${r.permission.action}`));
}

/** Kept for API compatibility; permissions are read consistently on each request. */
export function invalidatePermCache(_roleId?: string): void {}

/** Requires `module:action` permission. Use after authenticate. */
export function authorize(permission: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) return next(unauthorized());
    if (req.auth.userType === "CUSTOMER") return next(forbidden("Staff only"));
    try {
      const perms = await permissionsForRoles(req.auth.roleIds);
      if (!perms.has(permission)) return next(forbidden(`Requires ${permission}`));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Portal routes: ensures the authenticated user is a customer and exposes
 * req.auth.customerId. Services must scope every query by it.
 */
export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  if (req.auth.userType !== "CUSTOMER" || !req.auth.customerId) {
    return next(forbidden("Customer portal only"));
  }
  next();
}
