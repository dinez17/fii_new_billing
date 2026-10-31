# Billing run GST selection

Run billing now supports ALL, GST, and WITHOUT_GST alongside prepaid/postpaid cycle and month/year. The worker filters active subscribers by their saved chargeGst flag before pagination. Each group has an independent history row and retry results for the period. Old runs and scheduler events default to ALL.

The invoice-level subscriber/period uniqueness rule remains unchanged: running both groups and then ALL does not issue duplicate invoices. Retrying GST does not clear the without-GST run's results. Subscription invoice tax mode and the separate invoice number series continue to follow the subscriber.

Apply the additive BillingRun.taxMode migration and revised unique index before deploying the billing API and worker. Rebuild the tenant web application. Keep automatic scheduler behavior as ALL; this feature adds a choice for manual runs.
# Financial-year billing periods

Subscription periods follow the April–March financial year, independent of the
subscriber's activation month:

- Quarterly: April–June, July–September, October–December, January–March.
- Half-yearly: April–September, October–March.
- Annual: April–March.

Prepaid runs invoice at the first day of the period (annual: 1 April).
Postpaid runs invoice at the last day of the completed period (annual: 31 March).
Trigger the run for that boundary month with the matching subscriber type and GST mode.
Longer-than-monthly periods that began before service commencement are skipped:
the initial partial period must be invoiced manually. For service starting
5 November 2026, manually invoice through 31 December, then run quarterly prepaid
billing for January 2027 to invoice 1 January–31 March. Monthly behavior is unchanged.
Prices remain monthly amounts multiplied by the cycle length. Existing invoices
are retained and same-period subscription invoices are not duplicated. Review
existing activation-anchored future invoices before re-running historical periods
after changing to this schedule, to avoid overlapping coverage.
