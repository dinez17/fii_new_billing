# Customer photo, identity documents and CAF

Open Customers → Edit. GSTIN is available for all GST treatments and remains
required for B2B customers. Enter billing and service/installation addresses.
Save a new customer first; the editor stays open so documents can be added.

The **Photo, ID proof & CAF** section supports:

- Customer photo: PNG/JPEG, maximum 500 KB.
- ID proof front and back: PNG/JPEG/PDF, maximum 1 MB each.
- GST certificate: PNG/JPEG/PDF, maximum 1 MB.
- ID-proof type and reference number, saved separately from the basic profile.

Selecting a file uploads it immediately. Uploading to the same slot replaces
the previous file. **Save ID details** saves the proof type/reference. Leaving
the reference field blank retains the saved number. Save profile/GST/address
changes before generating the CAF.

**CAF PDF** in the customer list, or **Download CAF PDF** in the editor, generates
a printable form from the latest saved customer/company details, photograph,
GST details, masked ID reference, document checklist and assigned subscriptions.
Signature/date spaces remain blank for signing. The same PDF appends uploaded
ID front, ID back, then GST certificate (when uploaded). Image proofs fit on A4
pages; PDF proofs retain every original page. Missing documents are skipped.
Unreadable or password-protected proofs must be replaced before downloading.
Proof scans contain their original unmasked contents. Generating the
CAF does not mark the customer or documents as verified or signed.

File contents and ID references are encrypted with the application's existing
AES-GCM master key. Preserve that key alongside encrypted backups. Raw ID
numbers and encrypted file contents are excluded from list/profile replies.
Only masked ID references are returned. KYC/document/CAF endpoints require
`customer:update` and check customer ownership against the authenticated tenant.
Downloads use `Cache-Control: no-store`. KYC changes/uploads write audit events
without raw ID numbers or document contents.

## API

- `GET /api/v1/customers/:id/kyc`: proof type, masked reference and file metadata.
- `PUT /api/v1/customers/:id/kyc`: `idProofType` and optional `idProofNumber`.
  An omitted number is preserved; an explicit empty string clears it.
- `POST /api/v1/customers/:id/documents/:kind`: `{fileName,dataUrl}`; slots are
  `PHOTO`, `ID_FRONT`, `ID_BACK`, `GST_CERTIFICATE`. Supported file signatures,
  decoded sizes and photo MIME restrictions are checked before encryption.
- `GET /api/v1/customers/:id/documents/:kind`: authenticated binary download.
- `GET /api/v1/customers/:id/caf`: generated PDF, always using current saved data.

Apply the additive `20261027001000_customer_kyc_caf` migration before deploying
the new CRM service. Customer-linked KYC/documents cascade on customer removal.
No existing customer records or tenant permissions are changed by the migration.
