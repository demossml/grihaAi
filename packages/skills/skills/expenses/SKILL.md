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

## Full history / PDF
- «За весь период» = no fromDate/toDate — the tool queries all records.
- Для PDF-отчёта используй `expenses_report_pdf`, никогда не собирай данные руками.
- Итог отчёта = сумма всех записей чата (темы, если указана).

## Categories & corrections
- Категория — свободная строка из данных, никаких зашитых списков доменов.
- «перенеси в X» / «не туда» / «категория должна быть Y» → вызывай `expense_update`
  (category=X), не извиняйся текстом. Бот запомнит правило для этой группы.

## Report dimensions
- «по категориям» → `expenses_report_pdf` с `dimension: "category"`.
- «по поставщикам» → `dimension: "supplier"`; теги → `"tag"`; без разреза → `"none"`.
- Отчёт всегда из БД: секции и под-итоги считает tool, не LLM.
- После успешного `expenses_report_pdf` (или `generate_report` expense) PDF ставится
  в очередь отправки автоматически. НЕ вызывай `send_file` на тот же путь — будет дубль.
- Если в группе `report_attachment_only` / требуется «только PDF» — не пиши «Готово»
  и никакой сопроводительный текст.

## Flexible questions
- «сколько метров кабеля / какие болты» → `expenses_search` (ищет по позициям и
  фрагментам чеков). Если позиции не структурированы — честно скажи об этом и
  приведи фрагменты из tool-ответа.
