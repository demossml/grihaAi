import type { DelegationPlan, TaskComplexity } from "../../types/index.js";

/**
 * Delegation triage — messages that must NOT be delegated even if they look
 * multi-part. These are cheap, atomic operations where spawning sub-agents
 * would only add latency and isolation overhead.
 */
const NON_DELEGATABLE_SIGNALS = [
  "напомни",
  "remind",
  "запиши",
  "запомни",
  "зафиксируй",
  "добавь в память",
  "memory_add",
  "переведи",
  "классифицируй",
];

const CRUD_SIGNALS = [
  "найди",
  "найти",
  "покажи",
  "список",
  "list",
  "search",
  "напомни",
];

/**
 * Cheap complexity classifier. Heuristic-first; an optional LLM call can be
 * used later to make the decision smarter.
 */
export async function classifyComplexity(
  userMessage: string,
  _llmCall?: (prompt: string) => Promise<string>,
): Promise<{ complexity: TaskComplexity; reason: string }> {
  const lower = userMessage.toLowerCase();

  // Triage gate: short reminders, memory CRUD and simple classifications are
  // never delegated.
  if (userMessage.length <= 40 && NON_DELEGATABLE_SIGNALS.some((s) => lower.includes(s))) {
    return { complexity: "simple", reason: "Короткий reminder/CRUD — делегирование не нужно" };
  }
  if (CRUD_SIGNALS.some((s) => lower.startsWith(s)) && !lower.includes(" и ")) {
    return { complexity: "simple", reason: "Простая операция поиска/списка — делегирование не нужно" };
  }

  const complexSignals = [
    "и ",
    "а также",
    "параллельно",
    "несколько",
    "сравни",
    "проанализируй и",
    "подготовь отчёт и",
    "найди и составь",
    "разбей",
    "исследуй",
  ];

  const sentenceCount = (userMessage.match(/[.!?]/g) ?? []).length;
  const hasMultipleParts =
    complexSignals.some((s) => lower.includes(s)) || sentenceCount >= 3;

  if (hasMultipleParts || userMessage.length > 280) {
    return {
      complexity: "complex",
      reason: "Задача содержит несколько частей или достаточно объёмная",
    };
  }

  return { complexity: "simple", reason: "Задача выглядит атомарной" };
}

/**
 * Build a delegation plan. For COMPLEX tasks, asks the orchestrator (LLM) to
 * split the task into subtasks; on any failure falls back to a single task.
 */
export async function buildDelegationPlan(
  userMessage: string,
  llmCall: (prompt: string) => Promise<string>,
): Promise<DelegationPlan> {
  const { complexity, reason } = await classifyComplexity(userMessage);

  if (complexity === "simple") {
    return { complexity, reason, tasks: [] };
  }

  const prompt = `
Ты — оркестратор. Разбей следующую задачу руководителя/секретаря/бухгалтера на 2-5 независимых или слабо связанных подзадач.
Верни ТОЛЬКО валидный JSON вида:
{
  "tasks": [
    { "goal": "...", "role": "researcher|analyst|writer|scheduler|other", "context": "..." }
  ]
}

Задача:
${userMessage}
`.trim();

  const raw = await llmCall(prompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { complexity: "complex", reason, tasks: [{ goal: userMessage, role: "general" }] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      tasks?: Array<{ goal: string; context?: string; role?: string }>;
    };
    const tasks =
      Array.isArray(parsed.tasks) && parsed.tasks.length > 0
        ? parsed.tasks
        : [{ goal: userMessage, role: "general" }];
    return { complexity: "complex", reason, tasks };
  } catch {
    return { complexity: "complex", reason, tasks: [{ goal: userMessage, role: "general" }] };
  }
}

/** Format a delegation plan as a system-prompt hint (does not force the call). */
export function formatDelegationHint(plan: DelegationPlan): string {
  const tasks = plan.tasks
    .map(
      (t, i) =>
        `${i + 1}. [${t.role ?? "general"}] ${t.goal}${t.context ? ` (контекст: ${t.context})` : ""}`,
    )
    .join("\n");
  return [
    "## Delegation hint (adaptive router)",
    `Задача классифицирована как COMPLEX (${plan.reason}). Готовый план делегирования:`,
    tasks,
    "Ты можешь вызвать delegate_tasks с этими подзадачами или выполнить задачу самостоятельно — решение остаётся за тобой.",
  ].join("\n");
}

/**
 * Pre-filter for the agent loop: classify the incoming message and, only when
 * COMPLEX, build a delegation plan and return a system-prompt hint. SIMPLE
 * messages return null and never invoke the (LLM) orchestrator.
 */
export async function buildRouterHint(
  userMessage: string,
  llmCall: (prompt: string) => Promise<string>,
): Promise<string | null> {
  const { complexity } = await classifyComplexity(userMessage);
  if (complexity === "simple") return null;
  const plan = await buildDelegationPlan(userMessage, llmCall);
  return formatDelegationHint(plan);
}
