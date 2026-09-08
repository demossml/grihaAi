---
name: expense-invoice-tracking
description: Track expenses and invoices from receipts, voice or manual input. Never invent amounts, currencies or dates.
tags: [finance]
---

# Expense & Invoice Tracking

Track expenses and invoices as structured records.

## Workflow (expense)
1. Get the expense data (receipt OCR, voice, or manual).
2. If OCR/voice is uncertain about amount/currency/date/vendor — ask before saving.
3. Categorize with `transaction_categorize` (history first, then ask).
4. Save with `expense_add`.

## Workflow (invoice)
1. Get number, amount, currency, due date.
2. Save with `invoice_add`; statuses (`due`/`overdue`) are derived from the due date.
3. Review with `invoice_list`.

## Rules
- Never invent amounts, currencies or dates.
- "paid" is a financial action and goes through the approval policy.
