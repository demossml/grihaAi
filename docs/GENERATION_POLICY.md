# Generation Policy — token budget & temperature

## 1. Purpose

Programmatic limits on **output** size and temperature so simple chats stay cheap and analysis may use more tokens. No LLM inside the policy module.

## 2. Does this "train" the model?

**No.** Griha does not fine-tune weights in this path. "Learning" in product sense =
- structured memory in SQLite (expenses, archive, reminders),
- user rules / group setup,
- optional future calibration proposals from obs (not auto-applied).

Token budget is **runtime control**, not training.

## 3. Profiles

Complexity comes from the Router decision.

| complexity | intent | initial | soft | hard | temperature (typical) |
|------------|--------|---------|------|------|------------------------|
| trivial | short ack | low | mid | mid | low (~0.2) |
| simple | simple Q&A | | | | |
| medium | default | | | | |
| complex | analysis | high | higher | higher | higher (~0.6) |

Exact numbers: see `apps/agent/src/runtime/generation/profiles.ts` (source of truth).

## 4. Kind coefficients

Some kinds scale **initial** tokens (e.g. `report_dispatch` may use a floor so tool-calling is not starved at 128).
Invariant always: `initial ≤ soft ≤ hard ≤ CODE_HARD_CAP`.

## 5. Apply path (Telegram)

```
preparePoolRouting → budget
  │
  ▼
applyBudgetToModel(model, budget)   // clone Model, set maxTokens + temperature
  │
  ▼
session.setModel(...)
  │
  ▼
session.prompt(...)
  │
  ▼
finish → restore previous model
```

Flag `GRIHA_GENERATION_POLICY=1` required. Obs: `generation.budget` with `budgetApplied`, `budgetApplyStrategy=set_model`.

## 6. Extensions (tryExtendBudget)

Allocator can raise toward hard max in multi-pass designs. Telegram multi-pass extend may be **not wired** — check STATUS. Helper `tryExtendBudgetWithObs` emits `generation.extend` / `extend_denied`.

## 7. What budget does NOT do

- Does not choose which API vendor key to use.
- Does not replace Flash routing.
- Does not guarantee `finishReason=length` visibility if pi does not expose usage (`generation.finish` may have `usageAvailable: false`).

## 8. Report tool timeouts (не путать с token budget)

Это **timeout** на тяжёлые операции отчёта (не бюджет токенов). Чтобы зависший
report не ждал глобальный watchdog 300s:

| Операция | timeout |
|----------|---------|
| report data fetch (DB) | 30 000 ms |
| report render (PDF) | 90 000 ms |

Константы `REPORT_TOOL_TIMEOUTS` — `apps/agent/src/runtime/util/with-timeout.ts`.
Обёртка `withTimeout(label, ms, fn)` бросает `TimeoutError` (code `TOOL_TIMEOUT`).
При таймауте — короткий ответ «Отчёт не успел сформироваться…» + obs
`report.render.end ok=false` с кодом `report_timeout`/`report_data_timeout`.
Watchdog 300s остаётся last resort (обрыв `session.prompt` mid-flight не
гарантирован платформой).
