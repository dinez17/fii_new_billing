import pino from "pino";

export function createLogger(service: string) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.authorization", "req.headers.cookie", "headers.authorization", "headers.cookie",
        "*.password", "*.passwordHash", "*.token", "*.accessToken", "*.refreshToken",
        "password", "passwordHash", "token", "accessToken", "refreshToken",
      ],
      censor: "[REDACTED]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
