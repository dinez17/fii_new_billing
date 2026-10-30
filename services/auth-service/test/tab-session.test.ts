import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), setSession: vi.fn(), platform: false }));
vi.mock("../../../apps/admin-web/src/stores/auth", () => ({ useAuth: { getState: () => ({ setSession: mocks.setSession }) } }));
vi.mock("../../../apps/admin-web/src/lib/console", () => ({ get isPlatformConsole() { return mocks.platform; } }));
import { restoreSession } from "../../../apps/admin-web/src/lib/restore-session";

describe("new tab session restoration", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([false, true])("uses the correct console cookie (platform=%s)", async (platform) => {
    mocks.platform = platform;
    const profile = { id: "user", permissions: ["user:read"] };
    mocks.post.mockResolvedValue({ data: { accessToken: "fresh-access" } });
    mocks.get.mockResolvedValue({ data: profile });
    await restoreSession(mocks);
    const headers = { "X-FII-Console": platform ? "platform" : "tenant" };
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/auth/refresh", {}, { withCredentials: true, headers });
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/auth/me", { withCredentials: true, headers: { ...headers, Authorization: "Bearer fresh-access" } });
    expect(mocks.setSession).toHaveBeenCalledWith({ user: profile, permissions: profile.permissions, accessToken: "fresh-access" });
  });
  it("does not restore a session if its refresh cookie is expired", async () => {
    mocks.post.mockRejectedValue(new Error("Expired"));
    await expect(restoreSession(mocks)).rejects.toThrow("Expired");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });
});
