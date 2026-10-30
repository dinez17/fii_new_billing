# Multiple connections using the same plan

One subscriber can have multiple mappings to the same plan. Create subscriber uses Add buttons and an independent connection list rather than one checkbox per plan. Each connection has an optional location label and its own monthly price override. Up to 50 connection rows may be submitted during creation.

Edit subscriber → Add a plan / another connection allows choosing an already assigned plan. Existing connections can receive a location label using the save icon. Ending a mapping affects only its ID, not all occurrences of that plan. Tenant and subscriber scoping applies to location edits.

Existing connection rows also allow editing the selected plan, monthly price override, start date and optional location. Click the row's check icon to save all changes. Clearing the override restores the plan's standard price. Future-dated connections are skipped until their start month; ending or changing one connection leaves other mappings untouched. Issued invoice rows are snapshots and are not rewritten.

The subscriber list's Since column shows the earliest current connection start date, falling back to subscriber activation only when there are no active mappings. Billing uses the earliest applicable connection start as its cycle anchor, so historical periods can be filled after backdating service. The subscriber activation date remains separate metadata. Repeated runs skip existing invoices rather than rewriting them.

Billing writes one invoice line per connection, including its location and monthly override multiplied by billing frequency. Existing invoices retain their descriptions and prices. Adding a connection does not rewrite a previously issued invoice.

Apply the additive SubscriberPlan.location migration, then update CRM, the billing worker and tenant web application. Existing mappings remain intact with an empty location until edited.
