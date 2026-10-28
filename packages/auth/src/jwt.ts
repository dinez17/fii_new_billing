import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import jwt, { type SignOptions } from "jsonwebtoken";

/** Resolves key paths relative to cwd, falling back to the repo root
 *  (services run with cwd = services/<name>). */
function resolveKeyPath(p: string): string {
  if (isAbsolute(p)) return p;
  const fromCwd = resolve(process.cwd(), p);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(process.cwd(), "../..", p);
}

export interface AccessTokenClaims {
  sub: string;            // userId
  tenantId: string;
  userType: "STAFF" | "CUSTOMER";
  roleIds: string[];
  customerId?: string;    // set for portal users
  permVersion: number;
}

let privateKey: string | null = null;
let publicKey: string | null = null;

function getPrivateKey(): string {
  if (!privateKey) {
    const p = process.env.JWT_PRIVATE_KEY_PATH;
    if (!p) throw new Error("JWT_PRIVATE_KEY_PATH not set");
    privateKey = readFileSync(resolveKeyPath(p), "utf8");
  }
  return privateKey;
}

export function getPublicKey(): string {
  if (!publicKey) {
    const p = process.env.JWT_PUBLIC_KEY_PATH;
    if (!p) throw new Error("JWT_PUBLIC_KEY_PATH not set");
    publicKey = readFileSync(resolveKeyPath(p), "utf8");
  }
  return publicKey;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const ttl = (process.env.ACCESS_TOKEN_TTL ?? "15m") as SignOptions["expiresIn"];
  const issuer = process.env.JWT_ISSUER ?? "fii-billing";
  const audience = process.env.JWT_AUDIENCE ?? "fii-billing-web";
  return jwt.sign(claims, getPrivateKey(), {
    algorithm: "RS256",
    expiresIn: ttl,
    issuer,
    audience,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const issuer = process.env.JWT_ISSUER ?? "fii-billing";
  const audience = process.env.JWT_AUDIENCE ?? "fii-billing-web";
  return jwt.verify(token, getPublicKey(), {
    algorithms: ["RS256"],
    issuer,
    audience,
  }) as AccessTokenClaims;
}
