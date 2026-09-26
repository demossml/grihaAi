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
