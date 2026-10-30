# Mobile layout and installable apps

Tenant billing, platform administration and the customer portal each build their own manifest, icons, service worker and offline page. Existing Docker web builds include these assets. Production requires HTTPS; localhost is also supported. Development Vite sessions intentionally do not register service workers.

On Chrome/Edge, use **Install app** when offered, or the browser's Install menu. On iPhone/iPad, open the site in Safari and use **Share → Add to Home Screen**. Each hostname installs independently; normal account permissions and login still apply.

At widths up to 800px, shared table metadata presents lists and financial reports as two-column labelled cards, with full-width descriptions and an action footer. Desktop tables remain unchanged. Original controls and table semantics are retained. Grouped headers, spanning rows, footers and hidden pagination rows are supported. The tenant/platform navigation becomes a keyboard-accessible drawer up to 1024px. Forms, filters and dialogs fit phone widths with touch-sized controls.

The service worker caches public static assets and a generic offline page only. It bypasses API requests, requests carrying Authorization, cross-origin requests and all writes. Financial data, PDF documents and authenticated HTML are not cached. An internet connection is required for business operations; there is no offline transaction queue. Cache updates wait for the user to choose **Update app**, allowing edits to be saved first.

Build verification: `pnpm check`. Focused regression tests: `pnpm exec vitest run packages/browser/test/mobile-pwa.test.ts`. Browser verification should cover populated invoice/report cards, action buttons, pagination, menus and customer/subscriber dialogs at 360px, 390px, 768px and desktop widths, plus manifest registration and offline navigation on all three builds.

Tables that must retain a specialist horizontal layout can opt out using `data-mobile-layout="scroll"`; provide a labelled, scrollable container if doing so. New conventional tables receive mobile cards automatically.
