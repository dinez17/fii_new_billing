# Tab login and subscription GST

Protected pages restore the existing HttpOnly refresh cookie using the correct tenant/platform console header. A new tab can restore the signed-in session without placing access tokens in shared localStorage. Expired or revoked sessions still require login.

Subscribers have a `chargeGst` flag, defaulting to true for existing and new records. Create/Edit subscriber → GST billing supports plan GST rates or Without GST. The subscriber list shows the selected mode. Changes apply to future invoices; existing invoice amounts and line rates remain unchanged.

Recurring invoices for Without GST subscribers store zero line GST rates and zero CGST/SGST/IGST, with the selected mode snapshotted on the invoice. The customer's existing GST treatment remains unchanged. Manual invoices linked to that subscriber enforce the same mode on the server and show a matching zero-tax preview. Editing an invoice for the same subscriber retains its saved tax mode. Selecting a different subscriber applies that subscriber's mode.

Deploy the additive subscriber/invoice `chargeGst` migrations before restarting the backend services and billing worker. Rebuild the tenant/platform web images for the session restoration fix. No worker should be started against the old schema. Fresh tenant backups use the updated schema signature; older tenant-backup files require a compatible software version.
