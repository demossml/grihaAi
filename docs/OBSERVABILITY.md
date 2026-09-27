# Observability

## Storage
`~/.grish-ai/obs/events-YYYY-MM-DD.jsonl`
Disable: `GRIHA_OBS=0`

## Turn chain

```
turn.start → gate.allow|block → routing.decision → generation.budget → [tool.*] → generation.finish → turn.end → telegram.send.*
```

Same `correlationId` on one user turn.

## Event catalog (core)

| event | meaning |
|-------|---------|
| turn.start / turn.end | agent turn boundaries |
| gate.allow / gate.block | prefilter |
| routing.decision | role, kind, complexity, source, flashCalled |
| generation.budget | initial/soft/hard, budgetApplied |
| generation.finish | ok; usage often unavailable |
| reminder.create/fire/skip/expired | secretary reminders |
| secretary.expense.write | explicit expense |
| report.render.* | PDF render |
| telegram.send.document/message | outbound |
| telegram.send.reply | итог отправки ответа в чат: `ok:false` при провале текста/документа (в `data`: `textOk`, `docOk`, `hadFile`); `ok:true` при успехе |

## Privacy
Never log raw message text, OCR body, bot tokens, api keys.

## Query
Tool `obs_query` (operators); CLI if present.

## P0 Full trace

### Correlation timeline
```
turn.start → gate.* → routing.decision → generation.budget
  → spans: agent.prompt / tool.start|end / report.build_data|render_pdf
  → telegram.send.*
  → turn.end (pathTaken, hadReply, hadFile, code)
```

- `pathTaken` (turn.end data): `fast_report_pdf` | `full_agent` | `gate_only` | `unknown`.
- `withSpan`/`span.start`/`span.end` (`packages/observability/src/helpers.ts`) — timeline хода.
- `turn.start` data: `textHash` (sha256 slice 12) — отпечаток текста, не сам текст.
- `tool.start`/`tool.end` — `toolName`, `argsKeys` (только имена ключей), `durationMs`, `ok`,
  `argsHash`, `resultSummary` (безопасная сводка, без содержимого результата).

### Privacy
No raw message/OCR. Tokens usage only if provider returns (иначе `usageAvailable:false`).

### Report diagnostics
`report.build_data` / `report.render_pdf` (фазы `start`/`end`) — коды:
`OK` | `EMPTY` | `BUILD_FAILED` | `RENDER_FAILED` | `WRITE_FAILED` | `TIMEOUT_PDF` | `PATH_NOT_FOUND`;
`data`: `docCount`, `needsReviewCount`, `totalAmount`, `pdfBytes`, `pdfPathExists`, `pdfBasename`.
