import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { authenticator } from "otplib";
import { prisma } from "@fii/database";
import { AppError, badRequest, decryptSecret, encryptSecret } from "@fii/common";
import { audit } from "./audit.service.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function createAccountToken(userId: string, type: "PASSWORD_RESET" | "EMAIL_VERIFY", ttlMinutes: number) {
  const raw = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.accountToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.accountToken.create({ data: { userId, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) } }),
  ]);
  return raw;
}

async function deliver(to: string, subject: string, text: string): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_URL is required for account email delivery");
    return;
  }
  const transport = nodemailer.createTransport(smtpUrl);
  await transport.sendMail({ from: process.env.SMTP_FROM ?? "no-reply@fii-billing.local", to, subject, text });
}

export async function requestPasswordReset(email: string, tenantSubdomain: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email, tenant: { subdomain: tenantSubdomain, isActive: true } } });
  if (!user) return;
  const raw = await createAccountToken(user.id, "PASSWORD_RESET", 30);
  const base = process.env.APP_PUBLIC_URL ?? "http://localhost:8000";
  await deliver(user.email, "Reset your FII Billing password", `Reset your password within 30 minutes: ${base}/reset-password?token=${encodeURIComponent(raw)}`);
  await audit({ tenantId: user.tenantId, userId: user.id, action: "PASSWORD_RESET_REQUESTED" });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.accountToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!record || record.type !== "PASSWORD_RESET" || record.usedAt || record.expiresAt < new Date()) throw badRequest("Invalid or expired reset token");
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await bcrypt.hash(newPassword, 12), failedLogins: 0, lockoutUntil: null } }),
    prisma.accountToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ tenantId: record.user.tenantId, userId: record.userId, action: "PASSWORD_RESET_COMPLETED" });
}

export async function requestEmailVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const raw = await createAccountToken(user.id, "EMAIL_VERIFY", 24 * 60);
  const base = process.env.APP_PUBLIC_URL ?? "http://localhost:8000";
  await deliver(user.email, "Verify your FII Billing email", `Verify your email within 24 hours: ${base}/verify-email?token=${encodeURIComponent(raw)}`);
}

export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.accountToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!record || record.type !== "EMAIL_VERIFY" || record.usedAt || record.expiresAt < new Date()) throw badRequest("Invalid or expired verification token");
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.accountToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  await audit({ tenantId: record.user.tenantId, userId: record.userId, action: "EMAIL_VERIFIED" });
}

export async function beginMfaSetup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { tenant: true } });
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret), mfaEnabled: false } });
  return { secret, otpauthUrl: authenticator.keyuri(user.email, user.tenant.name, secret) };
}

export async function confirmMfa(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret || !authenticator.check(code, decryptSecret(user.mfaSecret))) throw new AppError(401, "INVALID_MFA", "Invalid authentication code");
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await audit({ tenantId: user.tenantId, userId, action: "MFA_ENABLED" });
}

export async function disableMfa(userId: string, password: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const validCode = user.mfaSecret && authenticator.check(code, decryptSecret(user.mfaSecret));
  if (!(await bcrypt.compare(password, user.passwordHash)) || !validCode) throw new AppError(401, "INVALID_CREDENTIALS", "Invalid password or authentication code");
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ tenantId: user.tenantId, userId, action: "MFA_DISABLED" });
}

export function verifyMfaCode(encryptedSecret: string, code?: string): void {
  if (!code) throw new AppError(401, "MFA_REQUIRED", "Authentication code required");
  if (!authenticator.check(code, decryptSecret(encryptedSecret))) throw new AppError(401, "INVALID_MFA", "Invalid authentication code");
}
