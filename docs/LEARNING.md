# Learning

Замкнутый цикл обучения Griha (wiring существующих модулей, не «вторая система»).

## L1 Experience

На завершении turn (core-agent `turn_end` + `TelegramSessionPool.finish()`):

```
turn complete → recordTurnExperience → TurnExperienceStore (idempotent by turnId)
```

- **Без LLM**, без skill proposals, без review-маршрутизации.
- Ошибки изолированы (`try/catch`) — learning никогда не ломает ответ пользователю.
- **Idempotency**: повторный `turnId` возвращает существующую запись, не дублируя.
- **Durability**: append-only JSONL `~/.grish-ai/learning/experiences.jsonl`
  (переопределяется `GRISH_AI_HOME`).

Call sites:
- `apps/agent/.pi/extensions/core-agent/index.ts` — `pi.on("turn_end")`.
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` — `finish()`.

API:
- `TurnExperienceStore` / `getTurnExperienceStore()` — `apps/agent/src/runtime/learning/turn-experience.ts`.
- `recordTurnExperience(store, input)` — `apps/agent/src/runtime/learning/record-turn-experience.ts`.

Поля записи: `turnId`, `task`, `result`, `success`, `error`, `toolsUsed`,
`skillId`, `userId`, `sessionKey`, `createdAt`.

## L0 Audit

Call graph as-is: [LEARNING_AUDIT_REPORT.md](LEARNING_AUDIT_REPORT.md).
