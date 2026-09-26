# Meta-Harness Foundation

Основа для будущего отдельного безопасного Meta-Harness контура.

## 1. Зачем собираем traces

Чтобы ответить на вопросы диагностики без повторного воспроизведения:
- почему модель не увидела нужную информацию (ContextTrace/RetrievalTrace);
- какой tool сломался и вернул ли он валидный результат (ToolTrace + validation);
- что именно было первичной причиной провала (primaryFailure/failureChain);
- был ли реальный исход задачи, а не «модель не упала» (TaskOutcome);
- на какой версии агента это случилось (agentVersion).

## 2. Какие данные доступны

- `AgentTrace` — traceId, sessionId (`tg:{userId}:{chatId}[:t:{threadId}]`),
  agentVersion, status, steps, retryCount, primaryFailure, failureChain, final.
- `AgentTraceStep` — шаги: `input`, `context`, `retrieval`, `model`,
  `tool_call`/`tool_result`, `validation`, `retry`, `error`, `final`.
- `ContextTrace` (step `context`) — источники контекста (sourceType/sourceId/reason/selected).
- `RetrievalTrace` (step `retrieval`) — queryType/candidatesCount/selectedCount/selectedSourceIds.
- `ToolTrace` (step `tool_call`/`tool_result`) — toolName/argumentsHash/status/errorCode/retryCount.
- `PrimaryFailure`/`failureChain` — классификация провала.
- `TaskOutcome` — реальный исход задачи.
- Секреты/токены/credentials в trace **отсутствуют** (redaction + hash вместо сырых args/result).

Хранение: SQLite `~/.grish-ai/traces.sqlite`, таблица `agent_traces` (retention 30 дней).

## 3. Как будущий Meta-Harness сможет читать

Read-only доступ к traces:

```ts
import { getTraceStore, toEvaluationRecord, computeMetrics } from "…/runtime/observability/index.js";

const store = getTraceStore();
const trace = store.get(traceId);              // один trace
const list = store.list({ since: "2026-09-01" }); // период
const rec = toEvaluationRecord(trace);         // AgentEvaluationRecord (проекция)
const metrics = computeMetrics(list);          // агрегация
```

`AgentEvaluationRecord` — read-only проекция: `{ traceId, sessionId, agentVersion,
taskType?, status, taskOutcome?, primaryFailure?, toolNames, metrics? }`.

Scores + (в будущем) исходники кандидатов — отдельный слой, **не** часть
read-only trace-контура.

## 4. Production Griha НЕ изменяет собственный код

Ни одна из подсистем observability не пишет файлы исходников, не трогает
git, не меняет prompts/skills напрямую. Tracing — только запись метаданных.

## 5. Self-modification — отдельный будущий этап

Автономная модификация кода, git merge/deploy, перезапись prompts,
reinforcement learning, авто-переключение моделей, повышение прав tools —
**не реализованы**. Это отдельный контур с обязательным sandbox и approval.

---

```
Griha source code self-modification capability: NO
Production code can modify itself: NO
```
