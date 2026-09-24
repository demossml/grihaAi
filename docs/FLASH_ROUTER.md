# Flash Router

Маршрутизация сообщения → `RoutingDecision` (role + complexity + kind) → GenerationPolicy.

## Flags

| Flag | Default | Effect |
|---|---|---|
| `GRIHA_FLASH_ROUTER` | OFF | rule → flash_llm → fallback (маршрутизация) |
| `GRIHA_GENERATION_POLICY` | OFF | budget через `session.setModel` |

## Pipeline

```
message → buildRoutingContext (userText≤1500, hasImage, hasVoice, hostHint, chatType)
  → tryRuleRoute (детерминированный, без LLM)
  → если rule неуверенный И flag И apiKey → callFlash (deepseek-v4-flash, max_tokens 256)
  → иначе fallbackRoute
  → resolveGenerationBudget(complexity, kind) при GRIHA_GENERATION_POLICY
  → applyRouteGuidance если kind=report_dispatch
  → session.setModel(applyBudgetToModel(...)) при budget; role=flash → deepseek-v4-flash
  → session.prompt
```

## Rule table (rule-route.ts — 1:1)

| Condition | role | kind | complexity |
|---|---|---|---|
| hasImage / hostHint=ocr | vision | vision_ocr | simple |
| hostHint=analysis или `проанализируй/сравни/почему/динамика/анализ/analysis/compare/why` | main | analysis | complex |
| hostHint=report или `отчёт/отчет/расход/закупк/итог/сумм/expenses/report/total` | flash | report_dispatch | trivial |
| текст 1–40 символов (без изображения) | flash | chat_reply | trivial |
| иначе (rule null) | fallback: main | chat_reply | medium |

Приоритет: analysis проверяется ДО report (`«Почему выросли расходы?»` → analysis).

Rule с confidence ≥ 0.8 → Flash LLM НЕ вызывается. Иначе (`GRIHA_FLASH_ROUTER=1` + apiKey)
→ LLM Flash; без apiKey → fallback (`main`/medium).

## report_dispatch guidance

Константа `REPORT_DISPATCH_GUIDANCE` инжектится в prompt (`applyRouteGuidance`): агент обязан
звать `report_data_expenses` / `report_data_problems`, не выдумывать суммы/позиции.

## Not done / limitations

- `flashCalled=false` когда rule-route сработал (Flash LLM не вызывается) — obs-поле.
- Calibration auto-apply (Phase 3) — не начат.
- `fallbackRoute` для неизвестного: `main`/medium (без LLM-переклассификации).
