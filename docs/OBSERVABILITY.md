# Observability (журнал работы Griha без LLM)

Журнал работы Griha пишется в JSONL без участия LLM — отдельный пакет
`@griha/observability`, CLI `griha-obs` и agent-tools `obs_summary` / `obs_query`
для операторского агента на Mac Mini.

## Конфигурация

| Переменная | Значение |
|---|---|
| `GRIHA_OBS=0` | выключает запись (emit становится no-op) |
| `GRIHA_OBS_DIR` | переопределяет каталог журнала |
| *(default)* | `~/.grish-ai/obs/events-YYYY-MM-DD.jsonl` (по дням) |

Запись включена по умолчанию, если `GRIHA_OBS != "0"`.

## CLI (`griha-obs`)

```bash
node apps/obs-cli/dist/bin.js tail --lines 100
node apps/obs-cli/dist/bin.js query --event gate.block --limit 20
node apps/obs-cli/dist/bin.js query --component report.render --chat-id -100
node apps/obs-cli/dist/bin.js path
```

Команды: `tail` (последние N сырых JSONL), `query` (фильтр по event/component/
chat-id, свежие первыми), `path` (каталог), `--help`.

## Agent tools (операторский агент на Mini)

Агент (TUI `pi` или Telegram DM) может вызвать tool'ы:

- `obs_summary` — сводка за период (счётчики event/component + последние ошибки).
- `obs_query` — чтение журнала с фильтрами (`event`, `component`, `chatId`,
  `correlationId`, `sinceMinutes`, `limit`).

Доступны только `owner`/`admin` (`canManage`). Внутри tool'а — только чтение
JSONL, без LLM.

Пример запроса в DM:

> «Почему не ушёл отчёт? Сделай obs_summary за последние 60 минут.
>  Если есть ошибки — obs_query event=report.render.end и telegram.send.document.
>  Кратко скажи: бот стартовал? были gate.block? был render? был send?»

## Что НЕ логируется

- bot token / API keys / authorization (redact `[REDACTED]`);
- полные тексты пользовательских сообщений и содержимое PDF;
- строки длиннее 500 символов обрезаются.

## Таблица event names (точки emit из O4)

| component | event | data |
|---|---|---|
| `telegram.bot` | `process.start` | pid |
| `telegram.bot` | `polling.started` | username |
| `telegram.bot` | `update.received` | chatType |
| `telegram.gate` | `gate.block` | reason, scenario, archive, suppressReply |
| `telegram.gate` | `gate.allow` | scenario, archive, suppressReply |
| `telegram.send` | `telegram.send.document` | bytes |
| `report.render` | `report.render.start` | reportType |
| `report.render` | `report.render.end` | reportType, bytes / error |
| `reminder` | `reminder.fire` | skipped=inactive / — |
| `bot` | `process.uncaught` / `process.unhandledRejection` | message |
