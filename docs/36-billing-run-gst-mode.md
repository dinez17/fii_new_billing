# Billing run GST selection

Run billing now supports ALL, GST, and WITHOUT_GST alongside prepaid/postpaid cycle and month/year. The worker filters active subscribers by their saved chargeGst flag before pagination. Each group has an independent history row and retry results for the period. Old runs and scheduler events default to ALL.

The invoice-level subscriber/period uniqueness rule remains unchanged: running both groups and then ALL does not issue duplicate invoices. Retrying GST does not clear the without-GST run's results. Subscription invoice tax mode and the separate invoice number series continue to follow the subscriber.

Apply the additive BillingRun.taxMode migration and revised unique index before deploying the billing API and worker. Rebuild the tenant web application. Keep automatic scheduler behavior as ALL; this feature adds a choice for manual runs.
