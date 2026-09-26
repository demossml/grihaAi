# Metrics

Агрегация метрик из persisted traces (Prompt 08). Не отдельная отчётность —
чистая агрегация поверх `agent_traces`.

## Как собрать

```ts
import { TraceStore, computeMetrics, buildDiagnosticReport } from "@griha/agent/...";

const store = getTraceStore();
const traces = store.list({ since: "2026-09-01" }); // период
const summary = computeMetrics(traces);              // MetricsSummary
const report = buildDiagnosticReport(traces);         // human-readable
```

## MetricsSummary

| Метрика | Поле | Как считается |
|---|---|---|
| task success rate | `successRate` | outcome `completed` / total |
| task failure rate | `failureRate` | outcome `failed` / total |
| tool success rate | `toolSuccessRate` | tool-шаги `success` / все tool-шаги |
| tool failure rate | `toolFailureRate` | tool-шаги `failed` / все tool-шаги |
| tool timeout rate | `toolTimeoutRate` | `primaryFailure.code === TOOL_TIMEOUT` / total |
| retry rate | `retryRate` | trace с `retryCount > 0` / total |
| avg duration | `avgDurationMs` | среднее `finishedAt - startedAt` |
| p95 duration | `p95DurationMs` | 95-й перцентиль |
| context token estimate | `avgContextTokens` | среднее `context.estimatedTokens` |
| retrieval hit rate | `retrievalHitRate` | retrieval с `selectedCount > 0` / retrieval-шаги |
| empty retrieval rate | `emptyRetrievalRate` | retrieval с `selectedCount === 0` / retrieval-шаги |
| validation error rate | `validationErrorRate` | `validation` шаги / tool-шаги |
| final response failures | `finalResponseFailures` | `final.success === false` |
| unresolved/blocked | `unresolvedTasks` | `needs_user_input`/`blocked`/`unknown`/`partially_completed` |

## Диагностический отчёт

`buildDiagnosticReport(traces)` → строка:
```
total_tasks, success_rate, failure_rate, unresolved, avg/p95 duration,
retry_rate, empty_retrieval_rate, validation_errors,
top_failure_categories, most_failing_tools
```

## Feedback

Механизм dislike/regenerate/correction в Griha **NOT FOUND** — UI/сигнала
обратной связи нет, поэтому linkage `feedback → traceId → sessionId → task →
agentVersion` не реализован (не создаём искусственный UI). Когда появится —
хранить связь через `traceId`.
