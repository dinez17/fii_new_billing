import bcrypt from "bcryptjs";
import { prisma } from "@fii/database";
import { forbidden, unauthorized } from "@fii/common";
import type { AccessTokenClaims } from "@fii/auth";
import { issueTokens, rotateRefreshToken, type TokenPair } from "./token.service.js";
import { audit } from "./audit.service.js";
import { verifyMfaCode } from "./account-security.service.js";
import { assertConsoleSession, type ConsoleScope } from "./console-session.js";

async function checkConsole(claims: AccessTokenClaims, scope?: ConsoleScope, expectedUserId?: string) {
  const isPlatformAdmin = scope ? (await prisma.role.count({ where: { id: { in: claims.roleIds }, code: "SUPER_ADMIN", tenantId: null } })) > 0 : false;
  assertConsoleSession({ id: claims.sub, userType: claims.userType, isPlatformAdmin }, scope, expectedUserId);
}

const MAX_FAILED = 5;
const PERM_VERSION = 1; // bump via role updates later

function assertTenantLicensed(tenant: { isActive: boolean; licenseStatus: string; trialEndsAt: Date | null; licenseEndsAt: Date | null }): void {
  const now = new Date();
  if (!tenant.isActive || ["SUSPENDED", "EXPIRED", "CANCELLED"].includes(tenant.licenseStatus)) throw forbidden("Tenant access is suspended");
  if (tenant.licenseStatus === "TRIAL" && tenant.trialEndsAt && tenant.trialEndsAt < now) throw forbidden("Tenant trial has expired");
  if (tenant.licenseStatus === "ACTIVE" && tenant.licenseEndsAt && tenant.licenseEndsAt < now) throw forbidden("Tenant license has expired");
}

async function buildClaims(userId: string): Promise<AccessTokenClaims> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { roles: true, tenant: true },
  });
  if (user.status !== "ACTIVE") throw forbidden("Account disabled");
  assertTenantLicensed(user.tenant);
  return {
    sub: user.id,
    tenantId: user.tenantId,
    userType: user.userType as "STAFF" | "CUSTOMER",
    roleIds: user.roles.map((r) => r.roleId),
    customerId: user.customerId ?? undefined,
    permVersion: PERM_VERSION,
  };
}

export interface LoginResult extends TokenPair {
  user: { id: string; name: string; email: string; userType: string };
  company?: { name: string; subdomain: string };
  permissions: string[];
}

/**
 * Login by email + password only — the company (tenant) is resolved from the
 * user account. Email uniqueness is per-tenant, so the rare case of the same
 * email existing under multiple companies is disambiguated by the password;
 * if the password matches more than one account, the most recent login wins.
 */
export async function login(
  email: string,
  password: string,
  expectedUserType: "STAFF" | "CUSTOMER",
  meta: { ip?: string; userAgent?: string },
  otp?: string,
  scope?: ConsoleScope,
): Promise<LoginResult> {
  const candidates = await prisma.user.findMany({
    where: { email, userType: expectedUserType, tenant: { isActive: true } },
    include: { roles: true, tenant: true },
    orderBy: { lastLoginAt: { sort: "desc", nulls: "last" } },
  });

  // constant-shape failure path: always compare against something
  if (candidates.length === 0) {
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalie");
    throw unauthorized("Invalid credentials");
  }

  let user: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (await bcrypt.compare(password, c.passwordHash)) { user = c; break; }
  }

  if (!user) {
    // wrong password: lockout bookkeeping when the account is unambiguous
    if (candidates.length === 1) {
      const only = candidates[0];
      if (only.status === "LOCKED") throw forbidden("Account locked — contact admin");
      const failed = only.failedLogins + 1;
      await prisma.user.update({
        where: { id: only.id },
        data: { failedLogins: failed, lockoutUntil: failed >= MAX_FAILED ? new Date(Date.now() + 15 * 60_000) : undefined },
      });
      await audit({ tenantId: only.tenantId, userId: only.id, action: "LOGIN_FAILED", ...meta });
    }
    throw unauthorized("Invalid credentials");
  }

  if (user.status === "LOCKED") throw forbidden("Account locked — contact admin");
  if (user.status !== "ACTIVE") throw forbidden("Account disabled");
  assertTenantLicensed(user.tenant);
  if (user.lockoutUntil && user.lockoutUntil > new Date()) throw forbidden("Account temporarily locked — try again later");
  if (user.mfaEnabled) {
    if (!user.mfaSecret) throw forbidden("MFA configuration invalid — contact admin");
    verifyMfaCode(user.mfaSecret, otp);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockoutUntil: null, lastLoginAt: new Date() },
  });

  const claims = await buildClaims(user.id);
  await checkConsole(claims, scope);
  const pair = await issueTokens(claims, meta);
  await audit({ tenantId: user.tenantId, userId: user.id, action: "LOGIN", ...meta });

  const { permissionsForRoles } = await import("@fii/auth");
  const perms = await permissionsForRoles(claims.roleIds);

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { name: true, subdomain: true },
  });

  return {
    ...pair,
    user: { id: user.id, name: user.name, email: user.email, userType: user.userType },
    company: tenant ? { name: tenant.name, subdomain: tenant.subdomain } : undefined,
    permissions: [...perms].sort(),
  };
}

export async function refresh(
  rawToken: string,
  meta: { ip?: string; userAgent?: string },
  scope?: ConsoleScope,
  expectedUserId?: string,
): Promise<TokenPair> {
  return rotateRefreshToken(rawToken, async (userId) => { const claims = await buildClaims(userId); await checkConsole(claims, scope, expectedUserId); return claims; }, meta);
}

export async function me(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, userType: true, tenantId: true,
      roles: { select: { role: { select: { id: true, code: true, name: true } } } },
    },
  });
  const { permissionsForRoles } = await import("@fii/auth");
  const perms = await permissionsForRoles(user.roles.map((r) => r.role.id));
  return { ...user, roles: user.roles.map((r) => r.role), permissions: [...perms].sort() };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw unauthorized("Current password incorrect");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  });
  // revoke all sessions on password change
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit({ tenantId: user.tenantId, userId, action: "PASSWORD_CHANGED" });
}
