# @griha/render-tools

Детерминированный PDF-рендер по фиксированным шаблонам (Spec-билдер на
`@json-render/react-pdf` → `@react-pdf/renderer`). Без headless-браузера.

## Слои

- `layout/` — design kit: `tokens` (цвета/страница), `shell` (шапка/подвал),
  `table` (тёмная шапка + striped), `barChart` (текстовые «█»-блоки), `format`.
- `templates/` — builders + `registry` (id → `render*`).
- `render.ts` — `renderDocument(rawInput, { outDir })` → `RenderResult`.

## Шаблоны

`expense-report`, `sales-report`, `meeting-minutes`, `sellers-report`,
`revenue-report`, `profit-report`, `generic-table-report`.

## Кириллица

`GRIHA_PDF_FONT_PATH` (TTF) или автопоиск Arial/DejaVu Sans.

## Сборка и тесты

```bash
npm run build -w @griha/render-tools
npm run test -w @griha/render-tools   # tsx --test src/**/*.test.ts
```

Данные для рендера приходят из `@griha/render-contracts` (`RenderRequestSchema`).
