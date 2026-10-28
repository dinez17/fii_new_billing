# Invoice PO, customer contacts and addresses

Invoice POST and PUT accept optional `poNumber` (trimmed, max 100). Omission on create inherits the selected subscriber PO; explicit blank/null suppresses it. Omission on update preserves it; blank clears it. Existing unpaid/no-payment/active-year editing restrictions apply. The invoice list exposes PO editing and cancellation beside Sales Return; cancellation requires a reason and retains existing payment/year guards.

Customer POST/PUT accept `additionalEmails` (up to 10 validated addresses), `stateName`, `installationCity`, `installationState`, `installationStateCode`, `installationPincode`. Existing `city/stateCode/pincode` represent the billing address. `serviceAddress` is the installation street address. Additional emails receive invoice and receipt notifications together with primary email, deduplicated. Only primary email identifies a portal account; changing it synchronizes that account transactionally and revokes refresh tokens. Primary email cannot be removed if a portal account exists.

Authenticated GET `/customers/pincode/:pincode` looks up a six-digit PIN through https://api.postalpincode.in/pincode/{pincode}, with an eight-second timeout. Only the PIN is sent. The postal district fills City; users can refine it. State maps to GST state code. Each address is independent. Failed lookup leaves manual entry available. Existing saved locations are not overwritten simply by opening the form.

Report date fields, displayed transaction dates and report CSV/XLSX/PDF date cells use `dd-mm-yyyy`. API date values remain ISO dates. GST offline-tool files keep their prescribed import format.

Verification: customer-contact persistence/portal identity and tenant isolation; invoice PO overrides, edits and clearing; subscriber PO unchanged; cancellation/edit guards; existing invoice balances; unit checks for PIN parsing, address validation and recipient deduplication. No real billing document or email is created/sent during verification.
