---
name: expenses
description: >
  Учёт чеков и накладных, суммы расходов по поставщику.
  По умолчанию — вся история чата. Период только если пользователь явно указал.
  Use when user asks about expenses, receipts, invoices, totals by supplier,
  or sends a receipt/invoice to store.
tags: [documents, finance]
---

# Expenses

## Rules
- NEVER invent totals. Always call `expenses_sum` or `expenses_list`.
- DEFAULT scope = full history of the current chat.
- Pass fromDate/toDate/period ONLY when the user explicitly names a period
  (e.g. «за две недели», «за март», «с 1 по 15»).
- Do NOT assume last 14 days or any other default period.
- If tool returns count=0, say records not found.
- If many needsReview, warn that some amounts may need verification.

## Forum topics
- Default: current topic only when the question is asked inside a topic.
- If user says «по всей группе» / «во всех темах» → scope=chat.
- Never invent cross-topic totals without tool scope=chat.
