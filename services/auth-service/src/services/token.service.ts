import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@fii/database";
import { unauthorized } from "@fii/common";
import { signAccessToken, type AccessTokenClaims } from "@fii/auth";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const refreshTtlDays = () => Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14);

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function issueTokens(
  claims: AccessTokenClaims,
  meta: { ip?: string; userAgent?: string },
): Promise<TokenPair> {
  const refreshToken = randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: {
      userId: claims.sub,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtlDays() * 86_400_000),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 255),
    },
  });
  return { accessToken: signAccessToken(claims), refreshToken };
}

/**
 * Rotation with reuse detection: a refresh token may be used exactly once.
 * Presenting an already-rotated token revokes every active session of that
 * user (stolen-token containment).
 */
export async function rotateRefreshToken(
  rawToken: string,
  buildClaims: (userId: string) => Promise<AccessTokenClaims>,
  meta: { ip?: string; userAgent?: string },
): Promise<TokenPair> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
  });
  if (!existing) throw unauthorized("Unknown refresh token");

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized("Refresh token reuse detected — all sessions revoked");
  }
  if (existing.expiresAt < new Date()) throw unauthorized("Refresh token expired");

  const claims = await buildClaims(existing.userId);
  const pair = await issueTokens(claims, meta);
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedBy: sha256(pair.refreshToken).slice(0, 16) },
  });
  return pair;
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
