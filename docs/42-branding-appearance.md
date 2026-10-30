# Tenant branding and appearance

The sidebar displays the signed-in tenant's name and company logo from Settings → Company profile. Updating or removing that logo invalidates the sidebar branding query immediately. A missing or broken tenant logo falls back to the shared FII VANIGA icon. Platform administrators retain FII VANIGA branding.

All login pages, browser favicons, Apple touch icons and installed PWA icons use the supplied FII VANIGA logo and app-icon artwork independently of the signed-in tenant. Existing installed apps may take time to refresh their icon; reinstalling refreshes the saved shortcut metadata.

The application uses Studio and the bundled Professional Inter font on all surfaces. Other theme/font choices and the Appearance control are removed. Sidebar hover uses sky blue with dark blue text; navigation font sizes are increased. Existing browser preferences are normalized to Studio/Inter. Invoice PDF fonts are independent.

`GET /api/v1/settings/branding` requires authentication and returns `{ name: string, logoUrl: string | null }`. The tenant is always taken from the verified session; URL/query/body tenant IDs have no effect. Unlike full company settings, this minimal display information does not require `settings:read`. Responses use `Cache-Control: no-store`, and the PWA service worker bypasses API requests.

The FII VANIGA static artwork is packaged in each frontend's `public/brand/` and `public/pwa/` folders. PWA icons use the symbol at 180, 192 and 512 pixels with a padded maskable variant. Tenant logos are never copied to those shared static assets.

The product name is **FII VANIGA — Smart Billing & Business Management**. Product strings are defined in `packages/browser/src/brand.ts`. The supplied full logo is used on login/recovery pages, and the separate icon is used for browser/PWA icons and sidebar fallback. Versioned `vaniga-` icon filenames refresh the artwork without changing the manifest ID, scope or existing installed-app identity. Tenant company names, logos, bank details and invoice identities remain independent.
