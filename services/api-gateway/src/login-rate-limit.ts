import rateLimit, { type Store } from "express-rate-limit";

export function loginRateLimit(store?: Store) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    ...(store ? { store } : {}),
    handler: (_req, res) => res.status(429).json({
      error: { code: "LOGIN_RATE_LIMITED", message: "Too many unsuccessful sign-in attempts. Please wait before trying again." },
    }),
  });
}
