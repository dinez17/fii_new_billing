import { createHash } from "node:crypto";

export const offlineHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#18334d"><title>FII — Offline</title><style>body{margin:0;background:#f1f5f9;color:#18334d;font:16px/1.6 system-ui;min-height:100dvh;display:grid;place-items:center}main{margin:24px;padding:28px;max-width:420px;border:1px solid #dce4ed;background:white;border-radius:18px}h1{font-size:25px}a{display:inline-block;padding:12px 22px;border-radius:8px;background:#4f46e5;color:white;text-decoration:none}</style></head><body><main><h1>You're offline</h1><p>Connect to the internet to view invoices and reports, or record payments. Billing actions are not saved or queued while offline.</p><a href="/">Try again</a></main></body></html>`;

export function serviceWorkerSource(version: string, mode: string): string {
  return `/* FII app shell only: authenticated data and documents are never cached. */
const PREFIX = ${JSON.stringify(`fii-${mode}-shell-`)};
const CACHE = PREFIX + ${JSON.stringify(version)};
const SHELL = ['/offline.html','/manifest.webmanifest','/pwa/${mode}-192.png','/pwa/${mode}-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);await self.clients.claim()})()));
self.addEventListener('message', event => {if(event.data && event.data.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch', event => {
 const request = event.request, url = new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||request.headers.has('authorization'))return;
 if(request.mode==='navigate') {event.respondWith(fetch(request).catch(async()=>await caches.match('/offline.html')||new Response('Offline. Reconnect to use FII.',{headers:{'Content-Type':'text/plain'}})));return;}
 if(!/^\\/assets\\/[^?]+\\.(js|css|woff2?|png|svg)$/.test(url.pathname)&&!SHELL.includes(url.pathname))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);const saved=await cache.match(request);if(saved)return saved;const response=await fetch(request);if(response.ok&&response.type==='basic')await cache.put(request,response.clone());return response})());
});`;
}

interface Emitter { emitFile(asset: { type: "asset"; fileName: string; source: string }): unknown }
export function pwaBuild(mode: "tenant" | "platform" | "portal") {
  const name = mode === "tenant" ? "FII Billing" : mode === "platform" ? "FII Platform Admin" : "FII Customer Portal";
  return {
    name: "fii-pwa", apply: "build" as const,
    transformIndexHtml(html: string) {
      return html.replace(/<title>.*?<\/title>/, `<title>${name}</title>`).replace("</head>", `<meta name="theme-color" content="#18334d"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="${name}"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/pwa/${mode}-180.png"><link rel="icon" type="image/png" href="/pwa/${mode}-192.png"></head>`);
    },
    generateBundle(this: Emitter, _options: unknown, bundle: Record<string, { fileName: string }>) {
      const version = createHash("sha256").update(JSON.stringify(Object.keys(bundle).sort())).digest("hex").slice(0, 16);
      const manifest = { id: "/", name, short_name: mode === "portal" ? "FII Portal" : mode === "platform" ? "FII Admin" : "FII Billing", description: `${name} — secure billing and account management`, lang: "en-IN", start_url: "/?source=pwa", scope: "/", display: "standalone", background_color: "#f1f5f9", theme_color: "#18334d", icons: [192, 512].map(size => ({ src: `/pwa/${mode}-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" })).concat([{ src: `/pwa/${mode}-maskable.png`, sizes: "512x512", type: "image/png", purpose: "maskable" }]) };
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(manifest, null, 2) });
      this.emitFile({ type: "asset", fileName: "offline.html", source: offlineHtml });
      this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorkerSource(version, mode) });
    },
  };
}
