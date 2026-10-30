import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), verify: vi.fn() }));
vi.mock("@fii/database", () => ({ prisma: { user: { findFirst: mocks.findFirst } } }));
vi.mock("../../../packages/auth/src/jwt.js", () => ({ verifyAccessToken: mocks.verify }));
import { authenticate } from "../../../packages/auth/src/middleware.js";

describe("current account access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verify.mockReturnValue({ sub: "user-1", tenantId: "tenant-1" });
  });
  async function request() {
    const next = vi.fn();
    await authenticate({ headers: { authorization: "Bearer previously-issued-token" } } as Request, {} as Response, next as NextFunction);
    return next;
  }
  it("checks the active account and tenant for an otherwise valid access token", async () => {
    mocks.findFirst.mockResolvedValue({ id: "user-1" });
    const next = await request();
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "user-1", tenantId: "tenant-1", status: "ACTIVE" }, select: { id: true } });
    expect(next).toHaveBeenCalledWith();
  });
  it("rejects existing access tokens after an account is deactivated or deleted", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const next = await request();
    expect(next.mock.calls[0][0]).toMatchObject({ message: "Account disabled or deleted" });
  });
  it("fails closed when account validation is unavailable", async () => {
    mocks.findFirst.mockRejectedValue(new Error("Unavailable"));
    const next = await request();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
