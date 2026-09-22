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

## Obs v2 — turn chain, budget, tools

События нового слоя (v2), все через `emit()` из `@griha/observability`,
один `correlationId` на ход:

| component | event | key data |
|---|---|---|
| `telegram.turn` | `turn.start` / `turn.end` | chatType, hasImage, hasVoice, textLen / ok, code, durationMs, hadReply, hadFile |
| `runtime.routing` | `routing.decision` | role, complexity, kind, confidence, source, reason, flashCalled |
| `runtime.generation` | `generation.budget` | policyVersion, complexity, kind, initial/soft/hard, temperature, budgetApplied, budgetApplyStrategy |
| `runtime.generation` | `generation.extend` / `generation.extend_denied` | fromMaxTokens→toMaxTokens / reason |
| `runtime.generation` | `generation.finish` | ok, code (unknown/error), usageAvailable, inputTokens/outputTokens, truncated |
| `agent.tool` | `tool.start` / `tool.end` | toolName, durationMs, code |

Поля `ObsEvent` дополнены: `threadId?`, `code?`. `QueryFilter` дополнен:
`code?`, `eventPrefix?` (event.startsWith).

## Budget analysis (калибровка)

| Вопрос | Где смотреть |
|---|---|
| Какой профиль | `generation.budget` complexity, initial/soft/hard |
| Применился? | `generation.budget` budgetApplied, budgetApplyStrategy |
| Расширяли? | `generation.extend` from→to |
| Отказ extend | `generation.extend_denied` reason |
| Не хватило токенов? | `generation.finish` code=length / truncated=true |
| Usage | inputTokens/outputTokens если usageAvailable |
| Провал хода | `turn.end` ok=false + code |

## Debug one turn

`turn.start` → `gate.*` → `routing.decision` → `generation.budget` → [`tool.*`] →
`generation.finish` → `turn.end` → `telegram.send.*` — всё один `correlationId`.

## Privacy

Никогда: сырой текст user/assistant, тело OCR, caption целиком, apiKey, bot token,
Authorization, password, base64, session JSONL. В `data` — только textLen/ocrLen/
toolName/code/counts/flags/reason. `maxTokens`/`initialMaxTokens` и другие
счётчики токенов НЕ redact-ятся (это числа бюджета, не секреты).
