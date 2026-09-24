# Flash Router — principles and behavior

## 1. What it is

The **Model Router** chooses:
- `role`: `flash` | `main` | `vision`
- `complexity`: `trivial` | `simple` | `medium` | `complex`
- `kind`: `chat_reply` | `report_dispatch` | `analysis` | `vision_ocr` | …

It does **not** compute expenses, does **not** assign ACL, does **not** set maxTokens by itself (Generation Policy does, using `complexity`/`kind`).

## 2. Pipeline

```
RoutingContext userText (≤1500 chars) hasImage, hasVoice, hostHint, chatType
  │
  ▼
tryRuleRoute()  ← pure TS, no LLM
  │
  ├─ confidence ≥ 0.8 → Decision (source=rule, flashCalled=false)
  ▼
if GRIHA_FLASH_ROUTER && apiKey
  ▼
callFlash(deepseek-v4-flash)  ← JSON only, max_tokens≈256
  │
  ├─ parse OK → Decision (source=flash_llm)
  └─ fail → fallbackRoute (source=fallback)
  │
  ▼
resolveGenerationBudget(complexity, kind)  if GRIHA_GENERATION_POLICY
  │
  ▼
applyRouteGuidance  if kind=report_dispatch
  │
  ▼
session.prompt (generation model — see Generation Policy / pool)
```

## 3. Why rules first

Calling Flash on every message wastes money. Obvious cases (photo, «отчёт/закупки», «почему», short «ок») are handled by keywords/length/image flags.

## 4. Rule table (must match `rule-route.ts`)

| Condition | role | kind | complexity | reason |
|-----------|------|------|------------|--------|
| hasImage / ocr hint | vision | vision_ocr | simple | has_image |
| keywords report/expense/закупк/итог/сумм | flash | report_dispatch | trivial/simple | report_keywords |
| keywords анализ/почему/сравни | main | analysis | complex | analysis_keywords |
| text length ≤ 40 | flash | chat_reply | trivial | short_text |
| else | null → Flash or fallback | | | |

**Order matters:** analysis keywords checked before report keywords so «Почему выросли расходы?» → analysis, not report_dispatch.

## 5. Flash LLM contract

System: return **only JSON** keys role, complexity, kind, confidence, reason.
Never invent chat ids or access rights. Never invent money amounts.
User payload: short fields only — **no full chat history**.

## 6. report_dispatch

Means: host/agent should use **DB tools**, not invent tables.
Pool injects:

`[ROUTE] report_dispatch: ... use expense/report tools... do not invent totals...`

## 7. Flags

| Env | Default | Meaning |
|-----|---------|---------|
| GRIHA_FLASH_ROUTER | OFF | enable routeMessage Flash branch |
| GRIHA_GENERATION_POLICY | OFF | apply token budget after decision |

## 8. Observability

Event `routing.decision` with role, complexity, kind, confidence, source, flashCalled.
