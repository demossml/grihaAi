import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverSkills, formatSkillsForPrompt } from "@griha/skills";
import { loadConfig } from "@griha/config";
import { buildRouterHint } from "../../../src/utils/routing/adaptive-router.js";
import { createHttpLearningLlm } from "../../../src/utils/learning/http-learning.js";

const LEARNING_LOOP_POLICY = [
  "## Closed learning loop",
  "After completing a task, consider whether a repeated procedure or reusable know-how should be captured as a new skill.",
  "Auto-created skills are flagged with `autoCreated: true`.",
].join("\n");

const DELEGATION_POLICY = [
  "## Task delegation policy",
  "Когда пользователь даёт задачу:",
  "1. Сначала оцени сложность (adaptive routing: SIMPLE vs COMPLEX).",
  "2. Если SIMPLE — выполни сам.",
  "3. Если COMPLEX — вызови инструмент delegate_tasks с подзадачами.",
  "4. Дождись результатов субагентов (инструмент check_subagents).",
  "5. Собери итоговый ответ.",
  "6. Важные находки субагентов сохраняй в Shared Insights (инструмент get_shared_insights).",
].join("\n");

const ORCHESTRATION_POLICY = [
  "## Orchestration flow",
  "Ты — оркестратор. Для каждой задачи иди по цепочке, не выполняя бизнес-логику сам:",
  "1. Определи intent (что хочет пользователь).",
  "2. Выбери skill/capability (см. список доступных skills).",
  "3. Получи нужный context через инструменты (meeting_prep, contact_briefing, briefing_generate, finance_summary, commitment_list) — не сканируй всю память вручную.",
  "4. Проверь policy (approval_required для side-effect / финансовых действий).",
  "5. Запусти workflow-шаг через соответствующий инструмент (commitment_add, expense_add, event_add, …).",
  "6. Верни результат.",
  "",
  "Доменная логика живёт в сервисах/инструментах, а не в твоём ответе.",
].join("\n");

export const LANGUAGE_POLICY = `
## Language Policy (strict)

Always respond in the same language the user is currently writing in.

Detection rules:
1. Look at the latest user message.
2. If the message is primarily in Russian → answer entirely in Russian.
3. If the message is primarily in English → answer entirely in English.
4. If the message mixes languages, prefer the language of the main content / question.
5. If the language is unclear or very short (emoji, single word, command), keep the language of the previous user message in this conversation.
6. Never switch language mid-reply unless the user explicitly asks to switch.

Do not translate the user's message back to them.
Do not add phrases like "I'll answer in English" or "Отвечаю на русском".
Just answer naturally in the matching language.
`.trim();

export default function coreAgent(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    const skills = await discoverSkills();
    const sections = [DELEGATION_POLICY, ORCHESTRATION_POLICY];
    if (skills.length > 0) {
      sections.unshift("## Available skills", formatSkillsForPrompt(skills), LEARNING_LOOP_POLICY);
    }
    sections.push(LANGUAGE_POLICY);

    // Adaptive router pre-filter: for COMPLEX messages add a ready delegation
    // plan as a hint. The agent still decides whether to call delegate_tasks.
    const cfg = loadConfig();
    if (cfg) {
      try {
        const hint = await buildRouterHint(event.prompt, createHttpLearningLlm(cfg));
        if (hint) sections.push(hint);
      } catch {
        // Router hint is best-effort — never break the agent on it.
      }
    }

    return { systemPrompt: `${event.systemPrompt}\n\n${sections.join("\n\n")}` };
  });

  pi.registerCommand("/skills", {
    description: "List available skills",
    async handler(_args: string) {
      const skills = await discoverSkills();
      const text =
        skills.length === 0
          ? "No skills found."
          : `Available skills:\n\n${formatSkillsForPrompt(skills)}`;
      pi.sendMessage({
        customType: "skills-list",
        content: [{ type: "text", text }],
        display: true,
        details: skills,
      });
    },
  });
}
