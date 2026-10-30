import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { mobileHeaderLabels } from "../src/responsive-tables.js";
import { pwaBuild, serviceWorkerSource } from "../src/pwa-build.js";
import { APP_FULL_NAME, APP_TAGLINE } from "../src/brand.js";

describe("mobile report labels", () => {
  it("keeps ordinary invoice field labels", () => {
    expect(mobileHeaderLabels([[{ label: "Invoice no" }, { label: "Date" }, { label: "Customer" }, { label: "" }]])).toEqual(["Invoice no", "Date", "Customer", ""]);
  });
  it("preserves grouped tax headers and row spans", () => {
    expect(mobileHeaderLabels([[{ label: "HSN", rowSpan: 2 }, { label: "CGST", colSpan: 2 }], [{ label: "Rate" }, { label: "Amount" }]])).toEqual(["HSN", "CGST / Rate", "CGST / Amount"]);
  });
  it("distinguishes debit and credit amounts in Tally reports", () => {
    expect(mobileHeaderLabels([[{ label: "Expenses" }, { label: "Amount" }, { label: "Income" }, { label: "Amount" }]])).toEqual(["Expenses", "Expenses — amount", "Income", "Income — amount"]);
  });
});

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn(), put: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), match: vi.fn(), keys: vi.fn().mockResolvedValue(["fii-tenant-shell-old", "other-app"]), delete: vi.fn().mockResolvedValue(true) };
  const fetch = vi.fn();
  const self = { location: { origin: "https://sales.example.test" }, addEventListener: (name: string, handler: (e: unknown) => void) => { handlers[name] = handler; }, clients: { claim: vi.fn().mockResolvedValue(undefined) }, skipWaiting: vi.fn() };
  runInNewContext(serviceWorkerSource("revision", "tenant"), { self, caches, fetch, URL, Response });
  return { handlers, cache, caches, fetch, self };
}
describe("PWA privacy and lifecycle", () => {
  it("emits separate installable manifests for all three origins", () => {
    for (const mode of ["tenant", "platform", "portal"] as const) {
      const files: Record<string, string> = {};
      pwaBuild(mode).generateBundle.call({ emitFile: asset => { files[asset.fileName] = asset.source; } }, {}, { "assets/test.js": { fileName: "assets/test.js" } });
      const manifest = JSON.parse(files["manifest.webmanifest"]);
      expect(manifest.display).toBe("standalone"); expect(manifest.scope).toBe("/");
      expect(manifest.id).toBe("/");
      expect(manifest.name).toContain("FII VANIGA");
      expect(manifest.description).toBe(APP_TAGLINE);
      expect(manifest.icons.every((icon: { src: string }) => icon.src.startsWith(`/pwa/vaniga-${mode}-`))).toBe(true);
      if (mode === "tenant") expect(manifest.name).toBe(APP_FULL_NAME);
      expect(manifest.icons.some((i: { sizes: string; purpose: string }) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
      expect(files["sw.js"]).toContain(`fii-${mode}-shell-`);
    }
  });
  it("does not intercept APIs, authenticated requests, writes or payment-provider requests", () => {
    const { handlers, caches } = worker();
    for (const request of [
      { url: "https://sales.example.test/api/v1/invoices", method: "GET", headers: new Headers() },
      { url: "https://sales.example.test/private.pdf", method: "GET", headers: new Headers({ authorization: "Bearer secret" }) },
      { url: "https://sales.example.test/api/v1/payments", method: "POST", headers: new Headers() },
      { url: "https://checkout.razorpay.com/script.js", method: "GET", headers: new Headers() },
    ]) {
      const respondWith = vi.fn(); handlers.fetch({ request, respondWith }); expect(respondWith).not.toHaveBeenCalled();
    }
    expect(caches.open).not.toHaveBeenCalled();
  });
  it("shows an explicit offline page instead of stale financial data on offline navigation", async () => {
    const { handlers, fetch, caches } = worker(); fetch.mockRejectedValue(new Error("offline")); caches.match.mockResolvedValue(new Response("Reconnect to use billing"));
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: { url: "https://sales.example.test/invoices", method: "GET", mode: "navigate", headers: new Headers() }, respondWith: (value: Promise<Response>) => { response = value; } });
    expect(await (await response!).text()).toBe("Reconnect to use billing"); expect(caches.match).toHaveBeenCalledWith("/offline.html");
  });
  it("caches only successful same-origin static files", async () => {
    const { handlers, fetch, cache } = worker(); cache.match.mockResolvedValue(undefined);
    fetch.mockResolvedValue({ ok: true, type: "basic", clone: () => new Response("script") });
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: { url: "https://sales.example.test/assets/app.js", method: "GET", headers: new Headers() }, respondWith: (value: Promise<Response>) => { response = value; } });
    await response; expect(cache.put).toHaveBeenCalledOnce();
    handlers.fetch({ request: { url: "https://sales.example.test/invoice.pdf", method: "GET", headers: new Headers() }, respondWith: () => { throw new Error("PDF must not be cached"); } });
  });
  it("cleans only this application's old cache and waits for explicit update approval", async () => {
    const { handlers, caches, self } = worker(); let done: Promise<void> | undefined;
    handlers.activate({ waitUntil: (value: Promise<void>) => { done = value; } }); await done;
    expect(caches.delete).toHaveBeenCalledWith("fii-tenant-shell-old"); expect(caches.delete).not.toHaveBeenCalledWith("other-app");
    expect(self.skipWaiting).not.toHaveBeenCalled(); handlers.message({ data: { type: "SKIP_WAITING" } }); expect(self.skipWaiting).toHaveBeenCalledOnce();
  });
});
