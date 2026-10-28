import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loginRateLimit } from "../src/login-rate-limit.js";

describe("login rate limits behind nginx", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.post("/login", loginRateLimit(), (req, res) => {
      res.status(req.headers["x-test-success"] === "yes" ? 200 : 401).json({ ok: true });
    });
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const login = (ip: string, success = false) => fetch(`${base}/login`, {
    method: "POST", headers: { "x-forwarded-for": ip, "x-test-success": success ? "yes" : "no" },
  });

  it("does not block repeated successful sign-ins", async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await login("192.0.2.10", true);
      await response.text();
      expect(response.status).toBe(200);
    }
  });

  it("limits failed attempts, supplies retry time, and isolates client addresses", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await login("192.0.2.20");
      await response.text();
      expect(response.status).toBe(401);
    }
    const blocked = await login("192.0.2.20");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()).error.code).toBe("LOGIN_RATE_LIMITED");
    const otherClient = await login("192.0.2.21", true);
    await otherClient.text();
    expect(otherClient.status).toBe(200);
    const spoofed = await login("203.0.113.1, 192.0.2.20");
    await spoofed.text();
    expect(spoofed.status).toBe(429);
  });
});
