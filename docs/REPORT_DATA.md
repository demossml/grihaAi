# Report data (`@griha/report-data`)

Отдельный пакет собирает расходы из БД (compact / expanded / problems).
LLM только передаёт параметры. PDF и Telegram — **не** здесь.

## Пакет

- `packages/report-data` — чистые типы + builders + service фасад.
- Не зависит от grammy / telegram / `@earendil-works/*` / fetch / PDF / LLM.
- Доступ к данным — только через интерфейс `ExpensesReader` (inject).
- Один `chatId` на запрос. Без `fromDate/toDate` → полная история (`fullHistory: true`).

## Слои

- `types.ts` — DTO (`ReportDataRequest`, `CompactExpenseReport`, `ExpandedExpenseReport`,
  `ProblemsListResult`, `ExpenseRow`, `ExpensesReader`).
- `resolve-period.ts` / `format.ts` — период и превью/парсинг без БД.
- `problems.ts` — классификация проблемных чеков.
- `builders/` — `aggregateSuppliers`, `buildSummary`, `buildCompactReport`, `buildExpandedReport`.
- `service.ts` — `createReportDataService({ reader, getGroupTitle? })`:
  `buildExpenseReport` (compact/expanded) + `listProblemExpenses`.

## Адаптер в agent

- `apps/agent/src/services/documents/reportDataAdapter.ts` —
  `createDocumentsExpensesReader(repo)` → `ExpensesReader`.
- `DocumentsRepository.listExpenseRowsForReport(...)` — read-only (не меняет `expenses_sum`).

## Tools (агент)

- `report_data_expenses` — `chatId` (обязателен, группа), `format` (compact|expanded),
  `fromDate`/`toDate`/`threadId` опционально. Возвращает JSON.
- `report_data_problems` — проблемные чеки группы для ручного дополнения.

Примеры args:

```json
{ "chatId": "-100…", "format": "compact" }
{ "chatId": "-100…", "format": "expanded", "fromDate": "2026-09-01" }
{ "chatId": "-100…" }   // report_data_problems
```

## Scope (группа vs личка)

- В группе `report_data_*` всегда scoped к текущей группе; чужой `chatId` → `CHAT_MISMATCH` (отказ).
- В личке: `chatId` ИЛИ `groupQuery` (название из setup `/groups`); затем ACL (`assertCanReadChat`).
- Несколько совпадений по названию → `AMBIGUOUS` + список кандидатов (без данных расходов).
- Пример: `groupQuery: "Ремонт"` → `chatId -100…`; сравнение case-insensitive, `ё`→`е`, partial fallback.

## Дозаполнение чеков (`document_fill`)

- Запись только в `apps/agent/src/services/documents/` (пакет `report-data` остаётся read-only).
- `document_fill` tool: `expenseId` (из `report_data_problems`) + поля `supplier/total/docDate/currency/items/note`.
- Scope как у `report_data_*`: группа — только свои чеки; личка — `chatId`/`groupQuery` + ACL.
- После fill с total → `needs_review=0`; чек другого чата → `CHAT_MISMATCH`; неизвестный id → `NOT_FOUND`.

## Что НЕ делает

- Не рендерит PDF, не шлёт `sendDocument`, не ходит в Telegram.
- Не вызывает `group_history` для суммирования чеков.
- Не вызывает LLM внутри пакета.

Связка «report-data → render → send» — отдельный (оркестратор) этап, вне этой серии.
