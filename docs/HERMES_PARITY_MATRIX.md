# HERMES → GRIHA PARITY MATRIX

Phase 0, дата: 2026-09-13. Источник истины: runtime-код Griha (`main` = `cf5b6c0`,
откаченное рабочее состояние `44834f1`) + docs Hermes (nousresearch.com) и
`NousResearch/hermes-agent` (MIT, reference behavior).

Статусы: **COMPLETE** (поведение эквивалентно и покрыто тестами),
**PARTIAL** (часть механики есть), **DIFFERENT** (намеренно иная, но корректная
реализация), **MISSING**, **NOT_APPLICABLE**, **UNKNOWN** (доказательств
недостаточно — не считать фактом).

---

## A. Agent Runtime / core loop

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| A1 | Agent loop (tool calling, multi-turn) | `agent/` tool loop | pi.dev `AgentSession` (`core-agent`), tool-цикл SDK | **COMPLETE** (др. движок) | — | — | — |
| A2 | Sub-session isolation | delegation docs | `TelegramSessionPool` (изолированные `AgentSession`, `SUB_SESSION_EXTENSIONS`) | **COMPLETE** | — | — | — |
| A3 | Единый Agent Runtime поверх движка | `agent/` модули | **Item 1.1**: `src/runtime/` — интерфейсы, `AgentKernelImpl` (registry+lifecycle), feature flag `HERMES_AGENT_RUNTIME` (off). Не подключено к prod-путям | **PARTIAL** (интерфейсы готовы) | Phase 2+: подключение движков по фазам | средний | — |
| A4 | Extensions = domain capabilities | plugins | extensions содержат фундаментальную логику (routing, memory, cron) | **PARTIAL** | поэтапный перенос фундамента в runtime | средний | A3 |

## B. Model Runtime / Router / Fallback

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| B1 | Роли моделей (main + aux slots) | docs configuring-models: main + 11 aux tasks | prod: `ModelRole = "main" \| "vision"`; **Item 2.1**: `ModelRuntimeRole` (9 ролей) + `ModelPolicy` + `TaskProfile` в `src/runtime/model/types.ts`, не подключено | **PARTIAL** (типы готовы) | Phase 3/8/11/12: подключение aux-слотов | средний | A3 |
| B2 | Машинный выбор модели (TaskProfile → router) | router семантика | prod: `ModelRouter` (vision getConfig); **Item 2.2**: `selectModelRole` + `resolveModelConfig` (`src/runtime/model/select.ts`), семантика main/vision парна prod, не подключено | **PARTIAL** (чистая функция) | wiring за `HERMES_AGENT_RUNTIME` | высокий (production defaults!) | B1 |
| B3 | Fallback chain (credential pool → primary → auxiliary) | docs providers: `fallback_providers`, credential pools | **Item 2.3**: `classifyError` + `FallbackChain` (`src/runtime/model/fallback-chain.ts`): 429/5xx/сеть/timeout→next, 401/403/context-overflow/unknown→стоп, без циклов; не подключено | **PARTIAL** (логика готова) | wiring за флагом + credential pools | высокий | B1 |
| B4 | Контекст-детект окна модели | docs: multi-source resolution | **Item 2.4**: `resolveContextWindow` (config.contextWindow→каталог→провайдер→128000) в `src/runtime/model/context-window.ts`; bootstrap пока хардкодит | **PARTIAL** (цепочка готова) | wiring в bootstrap | низкий | B1 |
| B5 | Aux: title/compression/approval/MCP-route | docs auxiliary slots | нет (vision/learning/embedding есть) | **MISSING** | Phase 3/11/12 по мере подсистем | средний | B1 |

## C. Context Engine / compression

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| C1 | Token accounting (usage anchor, provider usage) | docs context-compression, `usage_anchor.py` | **Item 3.1**: `estimateTokens`/`estimateMessageTokens`/`getActualUsage`/`ContextBudget` в `src/runtime/context/usage.ts`, не подключено | **PARTIAL** (чистые функции) | wiring + реальные usage-анкоры | средний | A3 |
| C2 | Dual compaction (50% agent / 85% gateway hygiene) | docs dual system | **Item 3.2**: `shouldCompress` (агент 0.5 / gateway 0.85, cooldown, minTurns) в `src/runtime/context/compaction.ts`, не подключено | **PARTIAL** (решение готово) | сам compress-алгоритм (4 фазы) + wiring | высокий | C1 |
| C3 | Prune старых tool results | Phase 1 алгоритма | **Item 3.3**: `pruneToolResults` (лимит, ошибки сохраняются, не-tool не трогаются) в `src/runtime/context/prune.ts`, не подключено | **PARTIAL** (чистая функция) | wiring в конвейер компакции | средний | C2 |
| C4 | Структурированный summary (Goal/Progress/Decisions/…) + iterative re-compression | Phase 3–4 | **Item 3.4**: `preserveSystemContext`/`preserveRecentTurns`/`summarizeMiddle`/`mergeSummaries`/`persistSummary`/`restoreSummary` + `CONTEXT_PRIORITY` в `src/runtime/context/summary.ts`, не подключено | **PARTIAL** (структурный шаблон) | aux compression model B5 (LLM-резюме) | средний | C2 |
| C5 | Prompt-cache awareness (Anthropic system_and_3) | `prompt_caching.py` | pi.dev провайдер-специфика; Griha на DeepSeek — cache у провайдера | **NOT_APPLICABLE** (пока) | — | — | — |

## D. Sessions / Session Search

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| D1 | Persistent sessions (SQLite, переживают рестарт) | docs sessions | `SessionManager` pi.dev (файловые сессии), Telegram-сессии `tg:{user}:{chat}` | **COMPLETE** | — | — | — |
| D2 | FTS5 session search + scroll | docs memory: `state.db` FTS5 | `searchSessions()`: FTS5 + LIKE-fallback, только LIMIT; **Item 4.1**: scroll-контракт (`src/runtime/session/scroll.ts`); **Item 4.3**: generic-RRF (`src/runtime/session/rrf.ts`) для FTS5+vector fusion (§9) | **COMPLETE** (scroll+RRF контракты готовы) | wiring в searchSessions | низкий | — |
| D3 | Session summaries | Honcho/session docs | **Item 4.2**: `SessionSummaryStore` + `InMemorySessionSummaryStore` (upsert с mergeSummaries C4, get/list/delete) в `src/runtime/session/summaries.ts` | **PARTIAL** (in-memory готов) | SQLite-wiring за флагом | низкий | D1 |
| D4 | `/new` session boundary | docs | `/new` в Telegram (reset пула) | **COMPLETE** | — | — | — |

## E. Memory

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| E1 | Persistent facts (MEMORY.md, char limits) | docs memory | `SqliteRagMemoryService` (remember/recall/search), FTS5+vector+RRF | **COMPLETE** (DIFFERENT storage — наша SQLite, лучше) | — | — | — |
| E2 | User profile (USER.md) | docs memory | `UserProfileService`, `formatPersonalContext` | **COMPLETE** | — | — | — |
| E3 | Memory tool add/replace/remove + duplicate prevention | docs memory | **Верифицировано (item 5.1)**: `findNearDuplicate` — FTS + normalizeText, та же категория/scope, near-dup → refresh `updated_at` вместо insert; покрыто тестами (memory-service.test.ts) | **COMPLETE** | — | низкий | — |
| E4 | Injection/скрытые символы scan при записи | docs memory security | **Item 5.3**: `scanMemoryContent`/`scanDecision` (zero-width, control, injection-маркеры, homoglyph) в `src/runtime/memory/scan.ts` | **PARTIAL** (сканер готов) | wiring в write-path (за флагом) | средний | E1 |
| E5 | Candidate → confidence → conflict → persist | правила спеки | **Item 5.2**: контракт §10 (`MemoryType`/`MemoryRecord`/`MemoryEngine`) + пайплайн (`evaluateCandidate`/`detectConflict`/`decidePersist`) + `InMemoryMemoryStore` (reinforce/contradict) в `src/runtime/memory/`, не подключено | **PARTIAL** (логика готова) | wiring к SqliteRagMemoryService за флагом | средний | E1 |
| E6 | Memory write_approval gate | docs memory | approval-gate есть для действий, не для memory | **MISSING** | Phase 11 | низкий | E1 |
| E7 | Session memory ≠ persistent ≠ search | docs memory | контекст сессии pi + persistent + searchSessions — различимы | **COMPLETE** | — | — | — |
| E8 | Honcho-диалектика (выводы о пользователе) | docs honcho | `personal-learning` + `learning-extractor` (частично) | **PARTIAL** | Phase 7: local dialectic (без Honcho) | средний | E2 |

## F. Skills

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| F1 | Discovery + progressive disclosure (levels 0/1/2) | docs skills | **Item 6.1**: `discloseSkill` (уровни 0/1/2) в `src/runtime/skill/disclosure.ts`; существующий discovery не менялся | **PARTIAL** (дисклозер готов) | wiring в формат промпта за флагом | низкий | — |
| F2 | `skill_manage` create/patch/edit/delete/write_file/remove_file | docs skills | `learning/skill-improver.ts` (создание); patch/diff нет | **PARTIAL** | Phase 6 | средний | — |
| F3 | Версионирование: read-before-write, diff, validation, rollback | Hermes issue #55647 урок | нет | **MISSING** | Phase 6 (обязательно, урок Hermes) | высокий | F2 |
| F4 | Skill quality score (successRate/usage/regression) | spec | нет | **MISSING** | Phase 7 | низкий | F3 |
| F5 | `/learn` из источников | docs skills | `learning-extractor` (частично) | **PARTIAL** | Phase 7 | средний | F2 |
| F6 | Hub/регистры/сканы при установке | docs skills hub | нет | **NOT_APPLICABLE** (offline-ассистент) | — | — | — |
| F7 | Slash-команды по скиллам | docs skills | нет (скиллы — в промпт агента) | **MISSING** (низкий приоритет) | позже | низкий | — |
| F8 | Conditional activation (requires/fallback toolsets) | docs skills | нет | **MISSING** | Phase 12 | низкий | F1 |

## G. Learning / Experience / User model

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| G1 | Background review после хода (cheaper model) | docs memory background_review | нет | **MISSING** | Phase 7 | высокий (нагрузка/стоимость) | B5 |
| G2 | Lesson routing: factual→memory, procedural→skill, preference→user model | spec | нет единого evaluator | **MISSING** | Phase 7 | средний | G1 |
| G3 | Experience store (task/context/tools/errors/result/eval/lesson) | spec | нет | **MISSING** | Phase 7 (SQLite, nullable) | низкий | G1 |
| G4 | Contradiction check / deprecate | Honcho semantics | нет | **MISSING** | Phase 7 | низкий | E5 |

## H. Delegation

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| H1 | Subagents с изолированным контекстом | docs delegation | `multi-agent` + `createRealSubAgentRunner` (изолированные сессии) | **COMPLETE** | — | — | — |
| H2 | Только summary в parent | docs delegation | SubAgentRunner возвращает результат | **COMPLETE** | — | — | — |
| H3 | Orchestrator + parallel workers + synthesis | docs delegation | `workflow/workflows.ts` + delegation-hint (частично) | **PARTIAL** | Phase 8 | средний | H1 |
| H4 | Depth limit, timeout, budget, toolset per worker | docs delegation | нет явных контрактов | **MISSING** | Phase 8 | средний | H1 |
| H5 | Отдельная delegation-модель | docs delegation | нет | **MISSING** | Phase 2/8 | низкий | B1 |

## I. Programmatic execution

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| I1 | execute_code (один скрипт вместо N tool calls) | spec | нет (sandbox для команд есть: LocalSandbox + RunscSandbox) | **MISSING** | Phase 9 (Node/TS) | высокий (безопасность) | K1 |
| I2 | Sandbox исполнения команд | docs security | `src/sandbox` (local + gVisor runsc) | **COMPLETE** | — | — | — |

## J. Automation / Cron

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| J1 | Cron: recurring + continuity + monitorMode | docs cron | `CronService` (runner, changeDetector, continuity, notepad, state_snapshot) | **COMPLETE** | — | — | — |
| J2 | One-shot / pause-resume / update / remove | docs cron | только create/list/enable/disable/run_now | **PARTIAL** | Phase 10 | низкий | J1 |
| J3 | Fresh session на каждый прогон | docs cron | runner через SubAgentRunner (изолированная сессия) | **COMPLETE** | — | — | — |
| J4 | No-agent (script) jobs | docs cron | нет (все через runner LLM) | **MISSING** | Phase 10 | низкий | J1 |
| J5 | Delivery target в мессенджер | docs cron (gateway) | нет в текущем `main` (было в откаченном P02 — в `archive/pre-rollback-2026-09-13`) | **PARTIAL** (архив-ветка) | Phase 10: перенести P02 | средний | J1 |

## K. Security / Approval

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| K1 | Command approval | docs security | `approval-gate`, `approval-thresholds` skill | **COMPLETE** | — | — | — |
| K2 | Action risk levels + requiresApproval | docs security | approval по типам действий | **PARTIAL** | Phase 11: ActionRisk enum | низкий | K1 |
| K3 | File write safety | docs security | валидация путей (file-send), gateway | **PARTIAL** | Phase 11 | низкий | — |
| K4 | Prompt-injection scanning | docs security | gateway (частично) | **PARTIAL** | Phase 11 | средний | — |
| K5 | Session isolation | docs security | субсессии + session trust (`gateway-context`) | **COMPLETE** | — | — | — |
| K6 | Sandbox | docs security | `src/sandbox` local + runsc | **COMPLETE** | — | — | — |
| K7 | MCP credential isolation | docs security | MCP нет | **NOT_APPLICABLE** пока | Phase 12 | — | L1 |

## L. MCP / Toolsets

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| L1 | MCP registry/discovery/execution | docs MCP | нет (connector — свои tool-коннекторы, не MCP) | **MISSING** | Phase 12 | средний | A3 |
| L2 | Toolsets + запрет самодобавления | docs toolsets | нет; аналог: фиксированные `SUB_SESSION_EXTENSIONS` | **PARTIAL** | Phase 12 | низкий | H4 |
| L3 | Tool permission layer | docs security | gateway + approval | **PARTIAL** | Phase 11/12 | низкий | K1 |

## M. Telegram integration

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| M1 | Gateway → agent transport | gateway docs | `telegram-bot` (Bridge/Controller/Pool, retry, heartbeat, topics) | **COMPLETE** (DIFFERENT, наш) | не трогать без необходимости | — | — |
| M2 | Пер-групповые правила/mention/archive | gateway docs | group-runtime, prefilter, chat-setup, archive | **COMPLETE** | — | — | — |
| M3 | Медиа/OCR/файлы | gateway media | полный конвейер (OCR/vision/expenses/retry) | **COMPLETE** | — | — | — |
| M4 | Cron → Telegram | gateway cron | MISSING в main (см. J5) | **PARTIAL** | Phase 10/13 | средний | J1 |

## N. Proactive

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| N1 | Briefing/anomaly/calendar proactive | proactive docs | `proactive-assistant` (briefing, anomaly, calendar) | **COMPLETE** | — | — | — |
| N2 | Background nudge/self-improvement | memory docs | нет | **MISSING** | Phase 7/14 | средний | G1 |

## O. Profiles / Bot Mode

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| O1 | Именованные боты (model/memory/skills/persona) | docs bot mode | нет (один конфиг) | **MISSING** | Phase 15 | средний | A3 |

## P. Observability / Cost

| # | Hermes capability | Hermes evidence | Griha evidence | Status | Required work | Risk | Deps |
|---|---|---|---|---|---|---|---|
| P1 | Метрики ходов/медиа | gateway metrics | `metrics.ts` (telegram_updates, media…) | **COMPLETE** | — | — | — |
| P2 | Cost tracking по моделям | dashboard usage | нет | **MISSING** | Phase 16 | низкий | B1 |
| P3 | Session model usage | `session_model_usage` | нет | **MISSING** | Phase 16 | низкий | B1 |

---

## Итоговый подсчёт

| Статус | Кол-во |
|---|---|
| COMPLETE | 17 |
| PARTIAL | 20 |
| MISSING | 21 |
| DIFFERENT | (внутри COMPLETE с пометкой) |
| NOT_APPLICABLE | 2 |
| UNKNOWN | 0 (непроверяемое вынесено в PARTIAL/риски) |

Самые рискованные MISSING: B3 fallback (production), C2 compaction (production),
F3 skill rollback (данные), I1 execute_code (безопасность), G1 background review
(стоимость). Начинать — с Phase 1 (runtime interfaces) после подтверждения.
