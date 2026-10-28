# Subscriber forms and full invoice editing

Subscribers default to ACTIVE in the UI. Creation supports searching plan names/codes while selecting up to ten plans, each with its own price override. Editing includes a searchable plan picker and prepaid/postpaid control. The subscriber address input is removed; installation address belongs to the customer. Existing subscriber address values are retained in storage. Changing type affects future billing, not issued invoices.

Customer create/edit has an installation-address copy checkbox. While checked, billing street, city, state, GST code and PIN changes propagate to installation, including asynchronous PIN results. Unchecking retains copied values for independent editing.

Invoice list pencil opens `/invoices/:id/edit`, using the same full form as creation. It loads existing customer, subscriber, PO, dates, items, prices, discounts, GST, notes and terms. PO sits beside Subscriber on the second header row. PUT `/invoices/:id` now accepts optional customerId, subscriberId (nullable), invoiceDate, dueDate, poNumber, items, notes and terms.

Invoice number and FY remain fixed. Only unpaid invoices with no receipts/payments, credited amounts, active credit/debit notes, and an unlocked active FY may be edited. A revised date must remain in the same FY and due date cannot precede it. Tenant/customer/subscriber/product relationships are checked. Stock reversals and new stock postings roll back with the edit on failure.

Financial edits emit `invoice.updated` transactionally through the outbox. Ledger worker appends a previous-amount reversal and revised receivable (including customer/date changes), using deterministic event-derived IDs in a single createMany to withstand redelivery. PO-only changes retain financial snapshots and do not emit adjustment events. Notifications are not resent automatically on edit; the existing Mail action sends the revised PDF when requested.

Verification includes full changes with interstate GST, stock reduction, rejected overselling with full rollback, date/tenant/payment guards, duplicate ledger delivery, and subscriber PO preservation.
