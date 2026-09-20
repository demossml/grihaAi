# PDF-отчёты

Рендер PDF — отдельный пакет `packages/render-tools` (Spec-билдер на
`@json-render/react-pdf` → `@react-pdf/renderer`). Агент отдаёт **только данные**,
layout живёт в пакете (никакого дублирования вёрстки в `apps/agent`).

## Матрица шаблонов

| template id          | Назначение            | Ключевые секции                 |
|----------------------|-----------------------|---------------------------------|
| `expense-report`     | Расходы группы / чеки | сводка, поставщики, развёртка   |
| `sales-report`       | Продажи               | сводка, позиции                 |
| `sellers-report`     | По продавцам          | таблица + bars                  |
| `revenue-report`     | Выручка по периодам   | table + bars                    |
| `profit-report`      | Прибыль               | KPI + breakdown                 |
| `generic-table-report` | Произвольная таблица | columns + rows                  |

## Архитектура

- `packages/render-contracts` — Zod-схемы (`RenderRequestSchema`, enum template id).
- `packages/render-tools/src/layout/` — design kit: `tokens` (цвета), `shell`
  (шапка/подвал/номер страницы), `table` (тёмная шапка + striped), `barChart`
  (текстовые «█»-блоки, без chart-либ), `format` (деньги/счётчики/парсинг).
- `packages/render-tools/src/templates/` — один файл-builder на шаблон + registry.
- `apps/render-cli` — CLI + MCP поверх `renderDocument`.
- `apps/agent` — `generate_report` → mapper (DB → `ExpenseReportInput`) → пакет.

## Как добавить шаблон

1. Тип входа в `src/templates/<name>.ts` (+ экспорт типа из `index.ts`).
2. `build<Name>Spec(input)` на layout kit.
3. `render<Name>(request)` → `renderPdfBuffer(...)`.
4. Регистрация в `src/templates/registry.ts` + id в `render-contracts` enum.
5. Тест в `src/render.test.ts` (bytes > 5000, кириллица).

## Кириллица

Шрифт с кириллицей — `GRIHA_PDF_FONT_PATH` (TTF); иначе ищется Arial/DejaVu Sans
по системным путям. Без шрифта рендер падает с явной ошибкой.

## Связь с agent

Только mapping данных: `buildExpenseReportInput` (расходы: group title из
`getChatTitleSync`, поставщики, чеки с позициями из `itemsJson`). Пустой data →
guard, PDF не создаётся.
