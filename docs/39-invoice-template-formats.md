# Invoice formats

Settings > Invoice format offers six tenant-specific choices: Commercial (default), Tally-style, Classic, Modern, Minimal and Compact Ledger. Select a card and choose Save as default.

The setting is stored as group INVOICE, key template. The settings API accepts only COMMERCIAL, TALLY, CLASSIC, MODERN, MINIMAL and COMPACT, with existing settings read/update permissions and authenticated tenant scope. Missing or unrecognized saved values render Commercial.

Both streamed PDF downloads and generated email attachment buffers read the saved tenant default. GST and without-GST invoices share the selected layout. Changing it affects subsequent PDF generation for existing and new invoices; it does not rewrite invoice amounts, numbers or tax treatment. PDFs already downloaded or sent stay unchanged.

All formats show billing and installation addresses, invoice dates, PO and billing period where present, item lines, amount in words, bank information, terms and signature. Longer invoices paginate without dropping rows. Tally-style uses a monochrome bordered grid; it is a PDF layout, not a Tally data export.

Validation: settings API integration covers authentication, all supported choices, invalid format rejection, persistence and tenant isolation. PDF integration covers all six formats for both tax modes, tenant scoping and fallback. Rendered samples are visually reviewed under output/pdf.

The five alternative designs use different document structures: Tally has a continuous boxed voucher form and an HSN table; Classic has a centered letterhead and left-hand totals; Modern places company branding in a sidebar beside stacked addresses; Minimal has a large editorial title, stacked recipients and a separate metadata column; Compact Ledger uses inline horizontal party records and an HSN column. Settings previews are images rendered from fixture PDFs, with a full-size preview link. A six-item invoice is checked on one page in every format; 40-row invoices retain all their rows across pages.

Three additional reference layouts are available: Telecom Statement (TELECOM_STATEMENT), Service Tax Summary (SERVICE_TAX) and IT Services (IT_SERVICES). They use tenant branding, contact, bank and tax data. Service Tax Summary groups actual tax by HSN and GST rate, including IGST for interstate invoices. Without-GST invoices omit the GST summary. IT Services shows a PAID stamp only for PAID status. Reference-company logos, legal declarations, e-invoice QR codes and identifiers are not copied. No e-invoice registration or digital signing is implied.

Reference fidelity revision: Telecom now follows the full-page bordered form with an office/invoice matrix, sparse service area, separate bank/declaration/terms blocks and approval boxes. Service Tax Summary uses the three-cell invoice header, an open vertical-column body with taxes at its bottom, merged CGST/SGST rate-and-amount headers, PAN, declaration/bank panel and customer seal area. IT Services uses a three-column registration/billing/invoice area, reference bands, buyer and bank columns, gray totals, terms and right-hand paid stamp. Missing e-invoice registration fields are not fabricated. Previews use a versioned URL to avoid stale images.
