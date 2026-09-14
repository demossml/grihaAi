/**
 * §34 master spec — Golden tests: deterministic fixtures.
 *
 * Один и тот же вход → проверка поведения цепочки без LLM:
 * selected model (роль/конфиг) → tool permissions (toolsets) →
 * compression (4-фазный конвейер) → final action (risk/approval).
 * Никакого сравнения текста LLM — только поведение.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GrishAiConfig } from "@griha/shared-types";
import {
  resolveModelConfig,
  selectModelRole,
  type TaskProfile,
} from "../../src/runtime/model/index.js";
import { compactContext } from "../../src/runtime/context/pipeline.js";
import type { ChatMessage } from "../../src/runtime/context/usage.js";
import {
  canUseToolset,
  DEFAULT_TOOLSET_POLICY,
  type Toolset,
} from "../../src/runtime/toolsets/toolsets.js";
import {
  classifyAction,
  requiresApproval,
  type ActionKind,
} from "../../src/runtime/security/risk.js";

// ── Фиксчуры (детерминированные входы) ───────────────────────────────────────

const FIXTURES = {
  complexDelegation: {
    task: {
      kind: "complex-delegation",
      needsReasoning: true,
      preferredRole: "delegation",
    } satisfies TaskProfile,
    config: {
      version: 1,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "k",
      setupCompletedAt: "2026-01-01",
      models: {
        main: { provider: "deepseek", model: "deepseek-v4-pro", apiKey: "k" },
        delegation: { provider: "openrouter", model: "cheap/planner", apiKey: "d" },
      },
    } satisfies GrishAiConfig,
    toolsets: ["delegation", "cron"] satisfies Toolset[],
    actions: ["read_file", "financial"] satisfies ActionKind[],
  },
  visionOcr: {
    task: { kind: "ocr", needsVision: true } satisfies TaskProfile,
    config: {
      version: 1,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "k",
      setupCompletedAt: "2026-01-01",
      models: {
        main: { provider: "deepseek", model: "deepseek-v4-pro", apiKey: "k" },
        vision: { provider: "deepseek", model: "vision-exp", apiKey: "v" },
      },
    } satisfies GrishAiConfig,
  },
  longConversation: {
    messages: [
      { role: "system", content: "инструкции" },
      { role: "user", content: "цель: собрать отчёт" },
      { role: "assistant", content: "decision: использовать шаблон" },
      { role: "user", content: "нужен ли созвон?" },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: "tool",
        content: `result ${i}`,
      })),
    ] satisfies ChatMessage[],
  },
};

describe("§34 Golden fixtures (детерминированное поведение)", () => {
  it("complex delegation: модель → delegation-слот, toolsets → разрешены, financial → approval", () => {
    const fx = FIXTURES.complexDelegation;
    // selected model: роль и конфиг
    assert.equal(selectModelRole(fx.task), "delegation");
    assert.equal(
      resolveModelConfig(fx.config, selectModelRole(fx.task)).model,
      "cheap/planner",
    );
    // tool permissions: дефолт не даёт всего; subagent-политика даёт свои toolsets
    assert.equal(canUseToolset("delegation", DEFAULT_TOOLSET_POLICY).allowed, false);
    const subagentPolicy = {
      allowed: fx.toolsets,
      adminActors: ["owner"],
    };
    for (const toolset of fx.toolsets) {
      assert.equal(canUseToolset(toolset, subagentPolicy).allowed, true);
    }
    // final action: чтение — без approval, финансы — требуют
    assert.equal(requiresApproval("read_file").required, false);
    assert.equal(classifyAction("financial").level, "high");
    assert.equal(requiresApproval("financial").required, true);
  });

  it("vision OCR: роль vision, vision-модель, main не подменяет", () => {
    const fx = FIXTURES.visionOcr;
    assert.equal(selectModelRole(fx.task), "vision");
    assert.equal(resolveModelConfig(fx.config, "vision").model, "vision-exp");
    assert.equal(resolveModelConfig(fx.config, "main").model, "deepseek-v4-pro");
  });

  it("long conversation: prune → structural → summary → merge (4 фазы)", () => {
    const result = compactContext(FIXTURES.longConversation.messages, {
      recentTurns: 1,
    });
    assert.deepEqual(
      result.phases.map((p) => p.phase),
      [1, 2, 3, 4],
    );
    assert.equal(result.prunedCount, 2, "два старых tool-результата вычищены");
    assert.equal(result.head.length, 1, "system сохранён");
    assert.equal(result.tail.length, 2, "последний turn сохранён");
    assert.ok(
      result.summary.decisions.includes("использовать шаблон"),
      "decision извлечён",
    );
    assert.ok(result.summary.openQuestions.includes("нужен ли созвон?"));
  });

  it("один и тот же вход → идентичный вывод (детерминизм)", () => {
    const a = compactContext(FIXTURES.longConversation.messages, { recentTurns: 1 });
    const b = compactContext(FIXTURES.longConversation.messages, { recentTurns: 1 });
    assert.deepEqual(a, b);
    assert.equal(
      requiresApproval("system_modification").required,
      true,
      "system_modification всегда требует approval",
    );
    assert.equal(classifyAction("delete_file").level, "high");
  });
});
