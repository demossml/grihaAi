---
name: invoice-followup
description: Track invoice due dates and follow up. Reminders are drafts; sending outside requires approval.
tags: [finance]
---

# Invoice Followup

Track invoices and surface what is due or overdue.

## Workflow
1. `invoice_list` (statuses derive from due dates automatically).
2. For `due`/`overdue` invoices, prepare a reminder **draft**.
3. Sending the reminder outside requires `approval_required` (action
   `email.send` or messenger) and an actual connector.

## Rules
- Without an accounting connector, tracking is based only on data the user
  provided.
- Marking an invoice `paid` is a financial action → approval policy.
