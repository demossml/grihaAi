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

## L4 Gated skill proposals

Procedural candidates → pending proposal только после evidence-порога:

```
SkillCandidateStore (procedural evidence) → maybeProposeFromCandidates
  → maybeCreateSkillProposal (threshold) → createPendingSkillProposal (pending)
```

- **Никогда**: auto-write production `SKILL.md`. **Никогда**: protected skills.
- Порог `LEARNING_THRESHOLDS`: `minEvidenceForSkillProposal = 3`,
  `minConfidenceForProposal = 0.6`.
- Protected (не ослаблять): `human-approval-gate`, `approval-thresholds`,
  `privacy-data-hygiene`, `delegation-triage` (+ security-термы через
  `isProtectedSkillContent`).
- Proposal — только `pending` (в `SkillProposalStore`, file-backed), с
  explainability: `summary`, `reason` (evidence count), `affectedSkillId`,
  `risk: low|medium`, `status: pending`. Активация — отдельно (`/skills-approve`).

API:
- `LEARNING_THRESHOLDS`, `maybeCreateSkillProposal(args, deps)` (детерминированный гейт).
- `maybeProposeFromCandidates(store, deps)` — дедуп **per skillId** (Map, не глобальный скаляр): один скилл не блокирует другой; повторный вызов с тем же объёмом evidence не дублирует proposal.
- `createPendingSkillProposal(draft)` — реальный pending в `SkillProposalStore`.

Dedup persist (переживает рестарт): `~/.grish-ai/learning/proposed-evidence.json`
(`skillId → last evidenceCount`). `loadProposedMap` / `persistProposedMap` —
best-effort (try/catch, никогда не бросают в caller). Сброс для тестов —
`resetProposedEvidenceForTests`.

Call site: `apps/agent/.pi/extensions/core-agent/index.ts` (после `routeBackgroundLessons`).

## L5 Skill version loader + evaluation gate + rollback

Versioning больше не «фиктивный»: loader видит active version.

```
loader: getActiveSkillBody(skillId) → active.txt (vN.md) ?? SKILL.md (fallback)
evaluate: evaluateCandidate(skillId, tracker) → successRate по окну (НЕ LLM score=1)
rollback: rollbackSkill(skillId, toVersion) → SKILL.md + active.txt
```

- **Evaluation** детерминированная (`evaluateCandidate`): нет данных →
  `insufficient_data`; `successRate < 0.5` по окну (default 20) → fail.
  Никогда `pass: true` только из-за proposal от LLM.
- **Activation** (`activateSkillProposal`): protected skill (через
  `isProtectedSkillName`) → block; при инъекции `qualityTracker` оценка идёт
  через `evaluateCandidate` (иначе legacy `qualityScore`).
- **Rollback** (`rollbackSkill(skillId, toVersion)`): переключает SKILL.md и
  active.txt на конкретную версию.

API:
- `getActiveSkillBody(skillId, skillsRoot)` / `getActiveSkillVersion` — loader.
- `evaluateCandidate(skillId, tracker, window?)` — детерминированная оценка.
- `rollbackSkill(skillId, toVersion, skillsRoot)` — откат.
- `SkillQualityTracker.window(skillId, n)` / `successRate(skillId, window?)`.

## Полный цикл (L0–L5)

```
execution → turn complete
  → recordTurnExperience (L1, idempotent by turnId)
  → recordTurnSkillOutcomes (L2, SkillQualityTracker)
  → background review → routeLesson → handlers (L3)
       factual → memory | preference → user-model | procedural → skill candidates
  → skill candidates → evidence threshold → pending proposal (L4)
  → proposal approve → evaluateCandidate (L5) → activate active version
  → loader getActiveSkillBody видит active version → measure → rollback (L5)
```

## L0 Audit

Call graph as-is: [LEARNING_AUDIT_REPORT.md](LEARNING_AUDIT_REPORT.md).
