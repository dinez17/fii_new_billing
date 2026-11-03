# Purchase invoice upload and review

New Purchase Bill accepts PDF, JPG and PNG files up to 5 MB. PDFs may have up to four pages. Uploading prepares a draft only; the existing save operation remains responsible for stock, supplier balances and accounting events.

The backend uses Poppler for text PDFs and Tesseract English OCR for images and scanned PDFs. Documents are processed locally on the application server, with no external AI provider or API key. Dockerfile installs the required tools. Extraction has per-command and overall time limits, a two-job concurrency cap and temporary-file cleanup.

Review supplier matches, invoice number/date, each product, GST and totals. Unknown rates/products are left for selection. Unreadable or unsupported tables require manual entry using the displayed source text. OCR is approximate; it never certifies a tax invoice. Confirmation resets when the draft is changed, and saving is disabled during extraction.

The original is stored with the purchase invoice, encrypted with the existing master encryption key. It is included in tenant backups. Ciphertext/file bytes are excluded from list/detail JSON responses. Users with purchase_invoice:read can download the original through a tenant-scoped authenticated endpoint. Duplicate source hashes are unique per tenant; supplier/bill-number uniqueness also remains enforced. No records are created by extraction itself.

API:
- POST /purchase-invoices/extract (purchase_invoice:create): fileName and base64 dataUrl; returns draft, warnings and sourceText.
- POST /purchase-invoices: optional sourceDocument with fileName, dataUrl and reviewed:true, alongside corrected purchase fields.
- GET /purchase-invoices/:id/original (purchase_invoice:read): original file, no-store and attachment disposition.

Migrations: 20261103100000_purchase_source_document adds nullable encrypted source and hash columns; prior purchases remain unchanged.

Boxed telecom formats support amount-only service rows and GST rates from either HSN summaries or explicit Output CGST/SGST labels. An explicit monthly due day can be resolved in the invoice month when it is not earlier than the invoice date. Whole-rupee supplier GST is selectable, persisted on the bill, and reused for purchase returns. Existing bills default to PAISE.

Photographed rate-first tables (serial, rate, description, quantity/unit, amount) support wrapped English product names without relying on Tamil header OCR. Arithmetic differences are retained and flagged, with a quantity suggestion available for review. An unspecified GST rate must be explicitly selected; a photo total must be present and match the draft before saving.

Unmatched extracted products can be created on the reviewed save, requiring product:create as well as purchase_invoice:create. Product creation, PRD code allocation, purchase and stock movements share one transaction. Normalized exact existing names are reused within the tenant, inactive matches require correction, and duplicate bills roll back any new products. New product names and goods/service type can be edited before saving. Upload/extraction never creates master records.

Rate-first photographed drafts default to Rates include GST; the reviewer must still confirm the actual GST rate. Inclusive discounts and tax are split from the gross line amount without adding tax again. The purchase stores its inclusive-price flag and original input rates; newly created products retain an exclusive purchase cost. Purchase returns reuse the stored flag. Selecting an existing product does not replace imported invoice prices.
