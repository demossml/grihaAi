---
name: financial-report
description: Generate weekly/monthly financial reports with deterministic totals by category and vendor.
tags: [finance, documents]
---

# Financial Report

Build financial reports from deterministic aggregation.

## Workflow
1. Call `finance_summary` (from/to period) — it computes totals, by-category,
   by-vendor and the comparison with the previous period.
2. For a fixed-format document, call `generate_report(reportType: "expense-report")`
   with the aggregated data (layout is fixed by the template).

## Rules
- Never compute totals by hand when the aggregation service can do it
  deterministically.
- Include anomalies and outstanding invoices when relevant.
- For a fixed-format PDF document, call `generate_report(reportType: "expense-report")`
  with the aggregated data. If your data is empty the tool fills it from the DB
  or returns «Нет данных для PDF-отчёта» — do NOT invent tables.
- Do NOT call `send_file` after the PDF tool: delivery is automatic and
  duplicate sends are suppressed.
