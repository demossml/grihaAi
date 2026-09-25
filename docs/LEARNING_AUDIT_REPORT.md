# LEARNING AUDIT REPORT

Аудит call graph существующих learning-модулей Griha (L0, только чтение).
Цель: понять, что РЕАЛЬНО вызывается в runtime, а что лежит «в ящике» без callers.

## Call graph (as-is)

```
Telegram session
  └─ TelegramSessionPool.runPrompt()            .pi/extensions/telegram-bot/TelegramSessionPool.ts:342
       └─ finish()  → emitTurnEnd / emitGenerationFinish   (observability only, БЕЗ learning)
       └─ НЕТ record experience, НЕТ review, НЕТ personal-learning

core-agent extension
  └─ pi.on("turn_end")                          .pi/extensions/core-agent/index.ts:81
       └─ maybeBackgroundReview(turn)           .pi/extensions/core-agent/background-review.ts:88
            └─ shouldBackgroundReview(turn)     src/runtime/learning/background.ts:40  (детерминированный триггер)
            └─ LLM (models.learning) → parseReviewLessons
            └─ результат → runtimeObservability.backgroundReview(...)   ← ТОЛЬКО телеметрия
                 └─ НЕ вызывается routeLesson / applyLessonRoute

personal-learning extension (только при hasUI)
  └─ pi.on("agent_settled") → maybeAutoLearn    .pi/extensions/personal-learning/index.ts:102
       └─ guard: `if (autoLearnInProgress || !ctx.hasUI) return;`
       └─ extractLearning(dialog, llm)          src/utils/learning/learning-extractor.ts:37
       └─ applyLearning(extraction, ...)        src/utils/learning/learning-extractor.ts:69
            └─ (flag on) routeLesson(...)       src/runtime/learning/routing.ts:44  → routes ВОЗВРАЩАЮТСЯ, но НЕ dispatch
  └─ proposeAndConfirm → proposeSkillImprovement → applySkillProposal / activateSkillProposal (skills-approve)
  └─ commands: /skills-improve, /skills-approve, /skills-rollback, /skills-reject
```

## CONNECTED

- `extractLearning` / `applyLearning` — вызываются из personal-learning
  (`maybeAutoLearn`, tool `extract_learning`, command `/learn`). `applyLearning`
  пишет preferences (profile) и notes (client notes) в SQLite.
- `shouldBackgroundReview` / `maybeBackgroundReview` — вызываются из core-agent
  `turn_end` (fire-and-forget). LLM-вызов идёт за флагом `GRIHA_AGENT_RUNTIME`.
- `routeLesson` — вызывается внутри `applyLearning` (W5) только при флаге, но
  результат (`routes`) лишь возвращается наружу и никуда не диспетчеризуется.
- `proposeSkillImprovement` / `applySkillProposal` / `activateSkillProposal` /
  `rollbackSkillVersion` — вызываются из personal-learning (proposal queue +
  команды `/skills-approve` / `/skills-rollback`).

## NOT CONNECTED (wiring gaps)

- `ExperienceStore` (`experience.ts`) — НЕТ runtime-caller. Только unit-тест
  `tests/unit/learning-experience.test.ts`. Метод называется `add()`, а не
  `record()`; нет поля `turnId` и нет идемпотентности.
- `SkillQualityTracker` / `recordOutcome` (`quality.ts`) — НЕТ runtime-caller.
  Только unit-тест `tests/unit/learning-quality.test.ts`.
- `UserModelStore` (`user-model.ts`) — НЕТ runtime-caller. Только unit-тест
  `tests/unit/learning-user-model.test.ts`.
- `SkillVersionStore` (`skill/versioning.ts`) — используется только как
  in-memory кэш внутри `skill-improver.ts` (`getVersionStore`). Сам **loader**
  скиллов (`packages/skills/src/discover.ts` → `discoverSkills`) читает
  `SKILL.md` напрямую и **не читает** `.versions/active.txt` — версионирование
  оторвано от фактической загрузки тела скилла в prompt.
- Уроки фонового review (`maybeBackgroundReview`) НЕ маршрутизируются — идут
  только в observability.

## Telegram path

- experience: **no** — `TelegramSessionPool.runPrompt()` не пишет experience.
- review: **yes** — core-agent `turn_end` → `maybeBackgroundReview`, но уроки
  идут только в `runtimeObservability.backgroundReview` (телеметрия).
- personal-learning: **no** — `maybeAutoLearn` гейтится `!ctx.hasUI`; в headless
  Telegram `hasUI=false` → авто-дообучение никогда не запускается.

## Persistence

| Store | memory-only / file / sqlite | path |
|-------|----------------------------|------|
| `ExperienceStore` | memory-only | — |
| `SkillQualityTracker` | memory-only | — |
| `UserModelStore` | memory-only | — |
| `SkillVersionStore` | memory-only (кэш) + файлы версий | `~/.grish-ai` skillsRoot: `core/.versions/vN.md`, `core/.versions/active.txt` |
| `SkillProposalStore` | file (JSON per proposal) | `~/.grish-ai/skill-proposals/<id>.json` |
| UserProfile / ClientNotes | sqlite | `~/.grish-ai/memory.sqlite` |

## Minimal next PR

Только запись Experience на завершении turn (scope L1): подключить
существующий `ExperienceStore` (или ввести минимальный durable store с
идемпотентностью по `turnId`) и вызывать запись в двух точках — core-agent
`turn_end` и `TelegramSessionPool.finish()`. Без LLM, без skill proposals, без
review-маршрутизации. Все ошибки изолировать (`try/catch`), никогда не ломать
ответ пользователю.

## Evidence

- `apps/agent/src/runtime/learning/experience.ts:40` — `class ExperienceStore` (метод `add()`, `:56`).
- `apps/agent/src/runtime/learning/quality.ts:37` — `class SkillQualityTracker` (`recordOutcome` `:64`).
- `apps/agent/src/runtime/learning/user-model.ts:40` — `class UserModelStore`.
- `apps/agent/src/runtime/learning/routing.ts:44` — `routeLesson`.
- `apps/agent/src/runtime/learning/background.ts:40` — `shouldBackgroundReview`.
- `apps/agent/src/utils/learning/learning-extractor.ts:69` — `applyLearning` (routeLesson `:95`).
- `apps/agent/.pi/extensions/core-agent/index.ts:81` — `pi.on("turn_end")` → `maybeBackgroundReview`.
- `apps/agent/.pi/extensions/core-agent/background-review.ts:88` — `maybeBackgroundReview`.
- `apps/agent/.pi/extensions/personal-learning/index.ts:102` — `maybeAutoLearn` (guard `!ctx.hasUI`).
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts:342` — `runPrompt` / `finish()` без learning.
- `apps/agent/src/utils/learning/skill-improver.ts:199` / `:240` / `:295` / `:346` — proposals/versioning.
- `packages/skills/src/discover.ts:79` — `discoverSkills` читает `SKILL.md`, не `active.txt`.
