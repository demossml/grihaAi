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

## Receipt parse hardening & backfill

- Детерминированный парсер (`apps/agent/src/services/documents/extractors/parsers.ts`):
  - `total` — только по якорям `ИТОГО`/`ИТОГ`/`ВСЕГО К ОПЛАТЕ`/`ИТОГ К ОПЛАТЕ`/`СУММА К ОПЛАТЕ`;
    не берётся из строк с `ИНН|КПП|ФН|ФД|ФП` и из голых 10–12-значных чисел (ИНН-like).
  - `date` — отклоняет год вне `[currentYear-5, currentYear+1]` (мусор OCR «2028»).
  - `supplier` — первый маркер юрлица/бренда (`ООО|ИП|ЗАО|ПАО|АО|МАГНИТ|ЛЕНТА|…`) в первых ~15 строках.
  - `items` — позиция только с ценой; отбрасываются `КАССОВЫЙ ЧЕК`/`ИНН`/заголовки поставщика.
- `needsReview` (детерминированно): true если `total`/`supplier`/`date` пусты, items пусты при
  длинном `rawText` (>80) или был отброшен подозрительный ИНН-like сумма.
- Отчёт: итог = `SUM(total)` из БД (не сумма `item.sum`); позиции с `sum<=0`/ИНН-like скрыты;
  category длиннее 60 символов → «без категории»; needsReview-чеки выносятся в счётчик
  `needsReviewCount`, не смешиваются с успешными строками.
- Backfill: `reparseExpenseFromRaw` (`apps/agent/src/services/documents/backfill.ts`) —
  перепарс из `raw_text` ТЕМИ ЖЕ parse-функциями; `dryRun`-флаг, batch до 50–200; только
  `needs_review=1 OR total IS NULL`; старые записи без `raw_text` пропускаются. LLM не источник total.

## Reparse expenses backfill (CLI)

Переразбор старых чеков из сохранённого OCR text новыми правилами парсера
(`apps/agent/src/services/documents/reparse-expenses.ts` → `reparseExpenses`).

```bash
# сухо — что изменится, без записи:
npm run reparse:expenses -- --dry-run --limit=50
# или: npx tsx apps/agent/scripts/reparse-expenses.ts --dry-run --limit=50

# запись (батч 200):
npm run reparse:expenses -- --limit=200

# --all — все записи с rawText (не только «проблемные»), фильтр по чату:
npm run reparse:expenses -- --all --limit=200 --chat-id=-5400215325
```

- Фото из Telegram **не** скачиваются: нужен сохранённый OCR text
  (`expense_documents.raw_text`, fallback `chat_archive.raw_text` по `file_unique_id`).
- Запись без `raw_text` → `skipped` (`reason=no_raw_text`) — только такие чеки переснять.
- Exit code 0 при любом итоге (в т.ч. partial errors); 1 — только если БД не открылась.

## Supplier normalization

- `normalizeSupplier` (`extractors/normalize-supplier.ts`) — единый канон supplier/category:
  `matchCanonical` (Магнит/Пятёрочка/Ozon/Wildberries/Лента/Банк Точка/Сбербанк/Победа)
  **до** `isJunk` (БИК/отделение/Покупатель/Получатель/«Кассовый чек»/«Товарный чек»/URL → undefined).
- Встроен в `parseSupplierFromText` (intake новых фото) и `cleanCategory` (`expenseReportTools`
  — группировка отчёта): «МАГНИТ»/«М МАГНИТ»/«МАГНИТ (Милан)» сливаются в «Магнит».
- Пустой/мусорный supplier → «без категории».
- **После деплоя**: `npm run reparse:expenses -- --limit=100` — переразбор применит канон к старым чекам.

## Expense report dispatch

- `kind=report_dispatch` → `runExpenseReportDispatch` (`services/documents/expense-report-dispatch.ts`)
  → `buildExpenseReportData` (БД) → render PDF → `sendDocument` (через session-file outbox).
- Без свободного LLM-цикла на успешном пути: один короткий text ack + один файл (не «только текст вместо PDF»).
- Orchestrator-таймаут рендера **60s** (`withTimeout`) — не ждём глобальный watchdog 300s.
- Файл валидируется `assertSendablePdf` (existsSync + size ≥ 1000) перед возвратом; никогда `ok:true` без файла.
- На Mini после деплоя: reparse для этого пути не нужен — данные берутся из БД as-is (канон уже в `cleanCategory`).

## Related

- `docs/TELEGRAM-BOT.md` — tools/scope (секция «Expense report tools»)
- `STATUS.md` — Phase 39 «Report data + fill»
- `packages/skills/skills/expenses/SKILL.md` — guidance

