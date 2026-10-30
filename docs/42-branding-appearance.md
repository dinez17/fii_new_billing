# Tenant branding and appearance

The sidebar displays the signed-in tenant's name and company logo from Settings → Company profile. Updating or removing that logo invalidates the sidebar branding query immediately. A missing or broken tenant logo falls back to the shared FII logo. Platform administrators retain FII branding.

All login pages, browser favicons, Apple touch icons and installed PWA icons use the FII artwork independently of the signed-in tenant. Existing installed apps may take time to refresh their icon; reinstalling refreshes the saved shortcut metadata.

The header's **Appearance** control offers the saved theme and font family. Font choices are Arial (default), Segoe UI, Trebuchet and Georgia, with system fallbacks. These preferences are saved per browser/hostname and synchronized between open tabs. They affect the application interface, not invoice PDF templates.

`GET /api/v1/settings/branding` requires authentication and returns `{ name: string, logoUrl: string | null }`. The tenant is always taken from the verified session; URL/query/body tenant IDs have no effect. Unlike full company settings, this minimal display information does not require `settings:read`. Responses use `Cache-Control: no-store`, and the PWA service worker bypasses API requests.

The FII static artwork is packaged in each frontend's `public/brand/` and `public/pwa/` folders. PWA icons use the symbol at 180, 192 and 512 pixels with a padded maskable variant. Tenant logos are never copied to those shared static assets.
