import { Router } from "express";
import { authenticate } from "@fii/auth";
import * as auth from "../services/auth.service.js";
import { revokeRefreshToken } from "../services/token.service.js";
import { clientMeta, h, parse } from "../http.js";
import { changePasswordBody, loginBody, refreshBody } from "../validators.js";
import { disableMfaBody, otpBody, passwordResetBody, passwordResetRequestBody, tokenBody } from "../validators.js";
import * as security from "../services/account-security.service.js";
import { parseConsoleScope, refreshCookieName } from "../services/console-session.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/v1/auth",
  maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14) * 86_400_000,
};

function cookie(req: Parameters<typeof clientMeta>[0], name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const item of raw.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function sendSession(res: Parameters<Parameters<typeof h>[0]>[1], result: Awaited<ReturnType<typeof auth.login>>, cookieName: string) {
  const { refreshToken, ...body } = result;
  res.cookie(cookieName, refreshToken, cookieOptions);
  res.json(body);
}

export const authRouter = Router();

authRouter.post("/login", h(async (req, res) => {
  const b = parse(loginBody, req.body);
  const scope = parseConsoleScope(req.get("X-FII-Console"));
  sendSession(res, await auth.login(b.email, b.password, "STAFF", clientMeta(req), b.otp, scope), refreshCookieName(scope));
}));

authRouter.post("/portal/login", h(async (req, res) => {
  const b = parse(loginBody, req.body);
  sendSession(res, await auth.login(b.email, b.password, "CUSTOMER", clientMeta(req), b.otp), refreshCookieName());
}));

authRouter.post("/password-reset/request", h(async (req, res) => {
  const b = parse(passwordResetRequestBody, req.body);
  await security.requestPasswordReset(b.email, b.tenant);
  res.json({ ok: true });
}));

authRouter.post("/password-reset/confirm", h(async (req, res) => {
  const b = parse(passwordResetBody, req.body);
  await security.resetPassword(b.token, b.newPassword);
  res.json({ ok: true });
}));

authRouter.post("/email/verify", h(async (req, res) => {
  await security.verifyEmail(parse(tokenBody, req.body).token);
  res.json({ ok: true });
}));

authRouter.post("/email/send-verification", authenticate, h(async (req, res) => {
  await security.requestEmailVerification(req.auth!.sub);
  res.json({ ok: true });
}));

authRouter.post("/mfa/setup", authenticate, h(async (req, res) => {
  res.json(await security.beginMfaSetup(req.auth!.sub));
}));

authRouter.post("/mfa/confirm", authenticate, h(async (req, res) => {
  await security.confirmMfa(req.auth!.sub, parse(otpBody, req.body).code);
  res.json({ ok: true });
}));

authRouter.post("/mfa/disable", authenticate, h(async (req, res) => {
  const b = parse(disableMfaBody, req.body);
  await security.disableMfa(req.auth!.sub, b.password, b.code);
  res.clearCookie(refreshCookieName(parseConsoleScope(req.get("X-FII-Console"))), { path: cookieOptions.path });
  res.json({ ok: true });
}));

authRouter.post("/refresh", h(async (req, res) => {
  const scope = parseConsoleScope(req.get("X-FII-Console"));
  const cookieName = refreshCookieName(scope);
  const rawToken = cookie(req, cookieName) ?? parse(refreshBody, req.body).refreshToken;
  const { refreshToken, ...body } = await auth.refresh(rawToken, clientMeta(req), scope, req.get("X-FII-User"));
  res.cookie(cookieName, refreshToken, cookieOptions);
  res.json(body);
}));

authRouter.post("/logout", h(async (req, res) => {
  const cookieName = refreshCookieName(parseConsoleScope(req.get("X-FII-Console")));
  const rawToken = cookie(req, cookieName) ?? parse(refreshBody, req.body).refreshToken;
  await revokeRefreshToken(rawToken);
  res.clearCookie(cookieName, { path: cookieOptions.path });
  res.json({ ok: true });
}));

authRouter.get("/me", authenticate, h(async (req, res) => {
  res.json(await auth.me(req.auth!.sub));
}));

authRouter.post("/change-password", authenticate, h(async (req, res) => {
  const b = parse(changePasswordBody, req.body);
  await auth.changePassword(req.auth!.sub, b.currentPassword, b.newPassword);
  res.json({ ok: true });
}));
