import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadPdf } from "../../../apps/admin-web/src/lib/pdf-download";

describe("named PDF downloads", () => {
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("saves verified PDF bytes with a portable filename and cleans up the URL", async () => {
    await downloadPdf(new Blob(["%PDF-1.7\nfixture"], { type: "application/octet-stream" }), "NG/2026-27/00002.pdf");
    expect(link.download).toBe("NG-2026-27-00002.pdf");
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type).toBe("application/pdf");
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-pdf");
  });
  it.each(["", "<?xml version='1.0'?><error/>", '{"error":"Not allowed"}'])("rejects a non-PDF response without opening a blank page", async (body) => {
    await expect(downloadPdf(new Blob([body]), "invoice")).rejects.toThrow("No valid PDF was received");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });
});
