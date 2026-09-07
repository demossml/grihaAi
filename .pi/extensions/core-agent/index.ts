import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverSkills, formatSkillsForPrompt } from "../../../src/utils/skills.js";

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

function skillsDir(): string {
  return path.resolve(process.cwd(), "skills");
}

export default function coreAgent(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    const skills = await discoverSkills(skillsDir());
    const sections = [DELEGATION_POLICY];
    if (skills.length > 0) {
      sections.unshift("## Available skills", formatSkillsForPrompt(skills), LEARNING_LOOP_POLICY);
    }
    return { systemPrompt: `${event.systemPrompt}\n\n${sections.join("\n\n")}` };
  });

  pi.registerCommand("/skills", {
    description: "List available skills",
    async handler(_args: string) {
      const skills = await discoverSkills(skillsDir());
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
