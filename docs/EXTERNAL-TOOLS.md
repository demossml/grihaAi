# Внешние инструменты рендера (External Tools)

Вынос рендера PDF/PPTX-отчётов из `apps/agent` в отдельные пакеты и CLI,
активируемые флагами (по умолчанию — старое поведение 1:1).

## Схема пакетов

```
packages/render-contracts   — zod-схемы RenderRequest/RenderBlock + типы RenderResult (без рантайма рендера)
packages/render-tools       — renderDocument(rawInput, {outDir}) → RenderResult (шаблоны + кириллица + atomic write)
apps/render-cli             — bin griha-render (pdf/pptx/list-templates/mcp)
packages/telegram-doctor-core — runOfflineChecks (чистые функции, без grammy/сети)
apps/telegram-cli           — bin griha-telegram (doctor)
apps/agent                  — точка ветвления renderViaCliOrLegacy (spawn CLI по флагу)
```

Слои зависят строго сверху вниз: `render-contracts` → `render-tools` → `render-cli` → `agent`.
В `render-contracts`/`render-tools`/`render-cli` запрещены: grammy, `@earendil-works/*`,
better-sqlite3, telegram-типы, сеть (кроме `--online` в doctor).

## Флаги

| Флаг | Значение |
|------|----------|
| *(нет)* | старый рендер 1:1 (`renderPdfReport` в `apps/agent`) |
| `GRIHA_RENDER_CLI=1` | рендер через spawn `apps/render-cli` |
| `GRIHA_RENDER_CLI_PATH` | путь к `dist/bin.js`, если не дефолт |
| `GRIHA_RENDER_CLI_TIMEOUT_MS` | таймаут CLI (default 60000) |
| `GRIHA_RENDER_MCP=1` + `mcp.servers` | рендер через MCP |
| `GRIHA_AGENT_RUNTIME=1` | включает MCP-runtime в агенте |

При сбое CLI (`!result.ok`) агент автоматически падает на legacy — файл всё равно появится.

## Как добавить template (checklist)

1. `packages/render-contracts/src/schemas.ts` — добавить имя в `RenderTemplateSchema` (enum).
2. `packages/render-tools/src/templates/<name>.ts` — `renderX(request)` → `{ buffer, warnings, pages? }`
   (spec-билдер на базе `SpecBuilder` из `templates/spec.ts`).
3. `packages/render-tools/src/templates/registry.ts` — зарегистрировать `[name, renderX]`.
4. `apps/agent` (опционально) — mapping `reportType` → template в `report-generator`
   (уже 1:1: `sales-report`/`expense-report`/`meeting-minutes`).
5. Тесты: `render-tools/src/render.test.ts` + при необходимости `render-cli/src/mcp.test.ts`.

Не использовать вымышленные имена (`finance_summary`, `expense_report`) — только как в коде агента.

## doctor

```bash
npm run build -w @griha/telegram-cli
node apps/telegram-cli/dist/bin.js doctor            # JSON { ok, checks }
node apps/telegram-cli/dist/bin.js doctor --pretty   # человекочитаемо
node apps/telegram-cli/dist/bin.js doctor --online   # + getMe (сеть, таймаут 10s)
```

Чеки (offline): `config-present`, `telegram-token-format` (токен НЕ выводится),
`proxy-mode`, `db-file`, `media-dir`, `render-cli-binary`.

## MCP-сервер griha-render

`griha-render` умеет работать как MCP stdio-сервер (line-delimited JSON-RPC).
Методы: `initialize`, `tools/list`, `tools/call`. Инструменты: `list_templates`,
`render_pdf`, `render_pptx`.

Пример конфигурации `~/.grish-ai/config.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "griha-render",
        "transport": "stdio",
        "command": "node",
        "args": ["apps/render-cli/dist/bin.js", "mcp"]
      }
    ]
  }
}
```

Активация MCP в агенте — только за флагом `GRIHA_AGENT_RUNTIME=1`
(см. `apps/agent/.pi/extensions/mcp-runtime`).
