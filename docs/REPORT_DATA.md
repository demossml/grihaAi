# Report data & expense fill

## Purpose

- Пакет `@griha/report-data` читает `expense_documents`, не вызывает LLM/OCR/PDF.
- Штатные отчёты: JSON → (позже) render → Telegram без модели в середине.

## Package

- Path: `packages/report-data`
- API: `createReportDataService`, `buildExpenseReport`, `listProblemExpenses`
- Formats: `compact` | `expanded`
- Period: `fromDate`/`toDate` optional = полная история (нет дефолтных «14 дней»).
- Доступ к данным — только через `ExpensesReader` (inject); без grammy/telegram/PDF/LLM.

## Tools

### report_data_expenses

- args: `chatId?`, `groupQuery?`, `format`, `fromDate?`, `toDate?`, `threadId?`
- returns: `ReportDataResult` JSON (`ok`, `report` с `summary`/`suppliers`/`documents`)

### report_data_problems

- args: `chatId?`, `groupQuery?`, `fromDate?`, `toDate?`, `threadId?`
- returns: список проблемных чеков (`count`, `items` с `reasons`/`suggestedFields`)

### document_fill

- args: `expenseId`, `supplier?`, `total?`, `docDate?`, `currency?`, `items?`, `note?`, `chatId?`, `groupQuery?`
- пишет в `expense_documents`; `needs_review` очищается при заданном `total`
- пакет `report-data` остаётся read-only (запись — в `apps/agent/src/services/documents/`)

## Scope rules

| Context | chatId source | Foreign chatId | groupQuery |
|---------|---------------|----------------|------------|
| group/supergroup | ctx only | DENY (CHAT_MISMATCH) | ignored |
| private | args.chatId ИЛИ groupQuery → setup title | ACL assertCanReadChat | yes |

## groupQuery

- Резолв по `ChatSetupRecord.chatTitle` (exact → partial; case-insensitive, `ё`→`е`).
- `AMBIGUOUS` → список кандидатов, без данных расходов.
- `NOT_FOUND` / `MISSING_CHAT_ID` — явные ошибки (без выдуманных id).

## What not to use

- Не вызывай `group_history` / `group_recent` для суммирования чеков.
- Не перезапускай OCR по запросу отчёта.
- Не вызывай LLM внутри пакета.

## Examples

```json
{ "chatId": "-100…", "format": "compact" }
{ "groupQuery": "Ремонт", "format": "expanded" }
{ "expenseId": "…", "total": 100, "supplier": "Магнит" }
```

## Related

- `docs/TELEGRAM-BOT.md` — tools/scope (секция «Expense report tools»)
- `STATUS.md` — Phase 39 «Report data + fill»
- `packages/skills/skills/expenses/SKILL.md` — guidance

