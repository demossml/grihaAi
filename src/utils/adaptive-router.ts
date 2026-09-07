import type { DelegationPlan, TaskComplexity } from "../types/index.js";

/**
 * Cheap complexity classifier. Heuristic-first; an optional LLM call can be
 * used later to make the decision smarter.
 */
export async function classifyComplexity(
  userMessage: string,
  _llmCall?: (prompt: string) => Promise<string>,
): Promise<{ complexity: TaskComplexity; reason: string }> {
  const lower = userMessage.toLowerCase();
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
