---
name: sales-report
description: Generate a fixed-format sales report document. Use when the user asks for a sales report, sales analytics, or sales performance summary.
tags: [report, sales]
---

# Sales Report

Generate a sales report using the dedicated report tool.

## Mandatory procedure
1. Gather the sales data the user provided (or request the missing figures).
2. Call the tool exactly like this:

   `generate_report(reportType: "sales-report")`

   with the gathered data as the tool's input.

3. Return the generated file to the user.

## Format policy (mandatory)
- The report layout, sections and structure are **fixed by the template**.
- You **must not** change the layout, section order, or structure — only fill in the data.
- Do not create your own sales report by hand. Always use `generate_report`.
