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

## Expense reports (PDF)
- For a PDF expense report call ONLY `generate_report(reportType: "expense-report")`.
  It pulls data from the DB (the same source as `expenses_sum`) — do NOT invent data for it.
- Do NOT also call `generate_report` with empty data.
- Do NOT call `send_file` on the generated PDF path: delivery is automatic
  (session-file), and duplicate sends are suppressed.
- If the tool returns EMPTY/NO_DATA («Нет данных для PDF-отчёта»): tell the user
  briefly — do NOT invent tables or numbers.

## Report data (обязательно)
- Вопросы «расходы / итог / отчёт по чекам» по группе:
  вызови `report_data_expenses` с `chatId` группы и `format=compact`
  (или `expanded`, если просят позиции чеков).
- Не вызывай `group_history` / `group_recent` для суммирования чеков —
  для сумм и итогов только `report_data_expenses`.
- «Проблемные чеки» (нет суммы / needs_review / пустой OCR) → `report_data_problems`.
- `chatId` бери из `/groups` или из явного id пользователя; не подставляй id лички.
- Scope: в группе — только текущая группа; в личке — `chatId` или `groupQuery`
  (название группы из setup; несколько совпадений → уточни у пользователя).

## Дозаполнение чеков (document_fill)
- Пользователь дал сумму/поставщика по проблемному чеку →
  `document_fill` с `expenseId` (id брать из `report_data_problems`, не выдумывать).
- `expenseId` — только из problems или явного id пользователя.
- После fill можно снова вызвать `report_data_expenses` для актуального итога.

## Group data and reports
- For "what happened in group X" / reports / counts use tools:
  `group_report`, `group_history`, `group_recent`, `groups_compare`, `expenses_*`.
- Never invent archive contents or totals without tool output.
- Always keep sourceChatId provenance when comparing groups.
- Preset «Ассистент (@)» ≠ scenario «Тихий секретарь».
