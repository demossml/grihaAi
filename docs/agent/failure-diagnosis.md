# Failure Diagnosis

Таксономия ошибок и диагностика неудач (Prompt 06).

## AgentErrorCode (адаптированный)

| Code | Когда | category |
|------|-------|----------|
| `MODEL_ERROR` | `turnCode = "prompt_error"` (session.prompt упал) | execution |
| `TOOL_ERROR` | tool вернул `isError` | execution |
| `TOOL_TIMEOUT` | `turnCode = "timeout"` (watchdog) | execution |
| `TOOL_INVALID_RESULT` | результат tool невалиден (валидация) | execution |
| `VALIDATION_ERROR` | schema/структурная ошибка | execution |
| `CONTEXT_MISSING` / `CONTEXT_TOO_LARGE` | контекст неполон / переполнен | context |
| `RETRIEVAL_EMPTY` / `RETRIEVAL_IRRELEVANT` | retrieval пуст / нерелевантен | context |
| `REPORT_ERROR` | render-contracts сбой (в т.ч. schema mismatch `INVALID_INPUT`) | media |
| `OCR_ERROR` / `STT_ERROR` / `FILE_ERROR` | медиа-конвейер | media |
| `TELEGRAM_ERROR` | Telegram API (retry/permanent) | telegram |
| `PERSISTENCE_ERROR` | DB/запись | persistence |
| `UNKNOWN` | fallback | unknown |

## PrimaryFailure

При `status = "failed"` trace содержит `primaryFailure`:

```
{ category, code, stepId?, toolCallId?, explanation? }
```

Проставляется в `TelegramSessionPool.finish()` из `turnCode`:
- `codeFromTurnCode("timeout")` → `TOOL_TIMEOUT`
- `codeFromTurnCode("prompt_error")` → `MODEL_ERROR`

## FailureChain

`failureChain` — упорядоченный список `{ stepId, stepType, code?, note? }`
шагов, приведших к провалу (в текущей реализации — шаги со `status: "failed"`).

Примеры цепочек:
- retrieval empty → context incomplete → model wrong decision
- tool call → timeout → retry → second timeout → final failure
- report generation → schema mismatch → `REPORT_ERROR`

## Mapping

- `codeFromTurnCode(turnCode)` — terminal turnCode → AgentErrorCode.
- `codeFromRenderError(renderCode)` — render-contracts `RenderErrorCode` →
  AgentErrorCode (`INVALID_INPUT`/`UNKNOWN_TEMPLATE`/`RENDER_FAILED`/`WRITE_FAILED` → `REPORT_ERROR`; `INTERNAL` → `UNKNOWN`).
- `categoryForCode(code)` — код → коарс-категория.

## Как читать провал

1. trace `status = "failed"` → смотри `primaryFailure.code` + `category`.
2. `failureChain` — последовательность failed-шагов (где именно сломалось).
3. `TOOL_TIMEOUT` ≠ `TOOL_ERROR`: первое — зависло, второе — вернуло ошибку.
4. `REPORT_ERROR` — генерация отчёта (schema mismatch виден явно, а не «generic error»).

## Retry (Prompt 07)

- Step `type: "retry"` + `retryCount` — повторная попытка (retry/fallback/…).
- `RetryTrace = { attempt, kind, reason?, from?, to? }`; `kind`: `retry`,
  `fallback`, `alternative_tool`, `new_model_call`, `full_restart`.
- Существующий retry в Griha — model fallback-цепочка (`FallbackChain` →
  `runtimeObservability.fallback`); generic tool-retry отсутствует.
- `retryCount` и `primaryFailure`/`failureChain` персистятся в `agent_traces`
  (`retry_count`, `primary_failure_json`, `failure_chain_json`).

## TaskOutcome (Prompt 07)

`final.taskOutcome` — реальный исход, не «модель не упала»:

| taskOutcome | Сигнал |
|---|---|
| `completed` | ok + был ответ |
| `failed` | !ok |
| `needs_user_input` | ok + approval-кнопки |
| `unknown` | ok, но без ответа |
| `partially_completed` / `blocked` | зарезервированы (не wired) |
