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

## L2 Quality

Подключение `SkillQualityTracker.recordOutcome` к execution (success/fail сигналы
для будущей regression):

```
turn complete → recordTurnSkillOutcomes(skillIds, success) → getQualityTracker()
```

- Используется существующий `SkillQualityTracker` (quality.ts) — без дублей.
- `recordOutcome` вызывается **только** когда `skillId` известен; `skillId =
  "unknown"` не пишется. На текущем этапе per-turn skillId не отслеживается —
  список пуст (наполняется в L3/L4 из review→skill-candidate route).
- Ошибки изолированы: один «плохой» skillId не роняет ход.
- **Durability**: минимальная, append-only JSONL
  `~/.grish-ai/learning/quality.jsonl` (переопределяется `GRISH_AI_HOME`).
  Трекер остаётся in-memory; JSONL восстанавливает count/success после рестарта
  (точная таймлайн не сохраняется).

API:
- `getQualityTracker()` — синглтон с best-effort load.
- `recordSkillOutcomes(tracker, skillIds, success, atMs?)` — чистая, изолированная.
- `recordTurnSkillOutcomes(skillIds, success, atMs?)` — durable-обёртка поверх синглтона.

Call sites:
- `apps/agent/.pi/extensions/core-agent/index.ts` — `pi.on("turn_end")`.
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` — `finish()`.

## L3 Review → routeLesson → handlers

Результат фонового review теперь не только телеметрия, но и маршрутизация:

```
review.lessons → routeLesson → applyLessonRoute
  factual     → memory    (MemoryEngine.remember, type=lesson)
  preference  → user-model (UserModelStore.observe, candidate)
  procedural  → skill     (SkillCandidateStore — ТОЛЬКО evidence, без proposal)
  unknown     → drop
```

- Skill-branch **не** вызывает `applySkillProposal` и **не** пишет `SKILL.md` —
  только накапливает candidate evidence (threshold + proposal — в L4).
- LLM-JSON невалиден → `parseReviewLessons` даёт `[]` → нет уроков, нет throw.
- Ни один handler не бросает наружу: ошибки → `"error"`, unknown → `"drop"`.
- Не зависит от `hasUI`: headless Telegram-путь тоже маршрутизирует уроки, когда
  сработал review (review за флагом `GRIHA_AGENT_RUNTIME`).

API:
- `applyLessonRoute(route, lesson, ctx)` — диспетчер.
- `routeBackgroundLessons(lessons, ctx?)` — loop routeLesson → applyLessonRoute.
- `SkillCandidateStore` / `getLessonRouteCtx()` — process-wide in-memory stores.

Call site: `apps/agent/.pi/extensions/core-agent/index.ts` — `pi.on("turn_end")`
(в `.then` результата `maybeBackgroundReview`).

## L0 Audit

Call graph as-is: [LEARNING_AUDIT_REPORT.md](LEARNING_AUDIT_REPORT.md).
