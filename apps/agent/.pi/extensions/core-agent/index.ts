import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverSkills, formatSkillsForPrompt } from "@griha/skills";
import { loadConfig } from "@griha/config";
import { buildRouterHint } from "../../../src/utils/routing/adaptive-router.js";
import { runtimeObservability } from "../../../src/utils/routing/runtime-observability.js";
import { createHttpLearningLlm } from "../../../src/utils/learning/http-learning.js";
import { buildProfileSection } from "./profile-section.js";
import { runExecuteCode } from "./execute-code.js";
import { pruneAgentToolResults } from "./tool-result-prune.js";
import { maybeBackgroundReview } from "./background-review.js";
import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import { getTurnExperienceStore, recordTurnExperience } from "../../../src/runtime/learning/index.js";
import { renderTelemetryDashboard } from "../../../src/runtime/observability/dashboard.js";
import { collectSkillCommands } from "./skill-commands.js";

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

/** Извлекает видимый текст из agent-сообщения (assistant/tool result). */
function extractMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (p): p is { type: "text"; text: string } =>
          !!p && typeof p === "object" && (p as { type?: unknown }).type === "text",
      )
      .map((p) => p.text);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

export default function coreAgent(pi: ExtensionAPI): void {
  // C3 (§8): гигиена конвейера — старые tool-результаты сверх лимита
  // вычищаются перед LLM-вызовом (только за флагом; off = 1:1).
  pi.on("context", (event) => {
    const pruned = pruneAgentToolResults(event.messages, process.env);
    return pruned ? { messages: pruned } : undefined;
  });

  // G1: фоновый review хода дешёвой моделью (models.learning) за флагом.
  // Fire-and-forget: результат не блокирует turn, ошибки глушатся внутри.
  pi.on("turn_end", (event, ctx) => {
    const usedTools = event.toolResults.length > 0;
    const hadError = event.toolResults.some((t) =>
      /error|ошибк|failed|exception/i.test(JSON.stringify(t.content ?? "")),
    );

    void maybeBackgroundReview(
      { turnIndex: event.turnIndex, usedTools, hadError },
      { config: loadConfig() },
    ).then((result) => {
      if (result && result.lessons.length > 0) {
        runtimeObservability.backgroundReview(result.turnIndex, result.lessons.length);
      }
    });

    // L1: запись experience на завершении хода (без LLM, идемпотентно).
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      recordTurnExperience(getTurnExperienceStore(), {
        turnId: `${sessionId}:${event.turnIndex}`,
        task: "(unknown)",
        assistantResponse: extractMessageText(event.message),
        success: !hadError,
        error: hadError ? "tool error" : undefined,
        toolsUsed: event.toolResults.map((t) => t.toolName),
      });
    } catch {
      // learning никогда не ломает ход.
    }
  });

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
      // W12 (O1/§29): профиль бота — только за флагом (off = секция пустая).
      const profile = buildProfileSection(process.env, cfg.profile);
      if (profile.section) sections.push(profile.section);
    }

    return { systemPrompt: `${event.systemPrompt}\n\n${sections.join("\n\n")}` };
  });

  // F7: slash-команды скиллов (frontmatter `commands:`) — только за флагом.
  // Off = новых команд нет (1:1). Best-effort: ошибки не ломают запуск.
  void (async () => {
    if (!isAgentRuntimeEnabled(process.env)) return;
    try {
      const skillCommands = collectSkillCommands(await discoverSkills());
      for (const command of skillCommands) {
        pi.registerCommand(command.name, {
          description: `Запустить скилл "${command.skillName}"`,
          async handler(_args: string) {
            await pi.sendUserMessage(
              `Use the "${command.skillName}" skill for this task. ${command.description}`,
            );
          },
        });
      }
    } catch {
      // Команды скиллов — best-effort.
    }
  })();

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

  // O2 (§31/§32): дашборд телеметрии. Off = disabled-сообщение (1:1).
  pi.registerCommand("/observability", {
    description: "Показать дашборд телеметрии (runs, события, токены/стоимость по ролям)",
    async handler(_args: string) {
      if (!isAgentRuntimeEnabled(process.env)) {
        pi.sendMessage({
          customType: "observability",
          content: [
            { type: "text", text: "Observability dashboard отключён (GRIHA_AGENT_RUNTIME=1 для включения)." },
          ],
          display: true,
        });
        return;
      }
      const report = renderTelemetryDashboard(runtimeObservability.snapshot());
      pi.sendMessage({
        customType: "observability",
        content: [{ type: "text", text: report }],
        display: true,
      });
    },
  });

  // I1 (§20): execute_code — N операций одним вызовом, sandbox обязателен для
  // опасного кода. Off = инструмент отвечает disabled без исполнения.
  pi.registerTool({
    name: "execute_code",
    label: "Execute code",
    description:
      "Выполнить TypeScript/JavaScript-код в sandbox (одна операция вместо серии tool-calls). Опасный код требует runsc. Python запрещён. Активно только при GRIHA_AGENT_RUNTIME=1.",
    parameters: Type.Object({
      language: Type.Union([Type.Literal("typescript"), Type.Literal("javascript"), Type.Literal("python")]),
      code: Type.String(),
      expectedResult: Type.Optional(Type.String()),
    }),
    async execute(
      _toolCallId: string,
      params: { language: "typescript" | "javascript" | "python"; code: string; expectedResult?: string },
    ) {
      const outcome = await runExecuteCode(params, process.env);
      return {
        content: [{ type: "text", text: outcome.text }],
        details: outcome,
      };
    },
  });
}
