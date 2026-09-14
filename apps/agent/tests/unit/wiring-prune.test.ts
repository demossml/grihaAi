import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pruneAgentToolResults } from "../../.pi/extensions/core-agent/tool-result-prune.js";

/**
 * C3 (матрица C3, §8) — prune старых tool-результатов за флагом.
 * Flag off → null (1:1). Flag on → старые tool-результаты сверх лимита
 * вычищаются; не-tool и ошибки сохраняются; порядок не меняется.
 */

const ON = { GRIHA_AGENT_RUNTIME: "1" };

interface M {
  role: string;
  content: unknown;
}

function toolResults(count: number, prefix = "r"): M[] {
  return Array.from({ length: count }, (_, i) => ({
    role: "tool",
    content: `${prefix}${i}`,
  }));
}

describe("pruneAgentToolResults (C3/§8)", () => {
  it("flag off → null (конвейер не меняется)", () => {
    const messages = [{ role: "user", content: "hi" }, ...toolResults(12)];
    assert.equal(pruneAgentToolResults(messages, {}), null);
  });

  it("без tool-сообщений → null", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ];
    assert.equal(pruneAgentToolResults(messages, ON), null);
  });

  it("tool-результаты в пределах лимита → null", () => {
    const messages = [{ role: "user", content: "hi" }, ...toolResults(8)];
    assert.equal(pruneAgentToolResults(messages, ON), null);
  });

  it("сверх лимита: старые вычищаются, последние 8 + не-tool сохраняются", () => {
    const user = { role: "user", content: "запрос" };
    const assistant = { role: "assistant", content: "ответ" };
    const messages: M[] = [user, ...toolResults(12), assistant];
    const pruned = pruneAgentToolResults(messages, ON);
    assert.ok(pruned, "prune применён");
    assert.deepEqual(
      (pruned as M[]).filter((m) => m.role === "tool").map((m) => m.content),
      ["r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11"],
    );
    assert.ok(pruned.includes(user), "не-tool user сохранён");
    assert.ok(pruned.includes(assistant), "не-tool assistant сохранён");
    assert.ok(pruned.indexOf(user) < pruned.indexOf(assistant), "порядок не меняется");
  });

  it("результаты с ошибками сохраняются сверх лимита", () => {
    const messages: M[] = [
      { role: "user", content: "hi" },
      ...toolResults(8),
      { role: "tool", content: "tool failed with error" },
      { role: "tool", content: "r9" },
    ];
    const pruned = pruneAgentToolResults(messages, ON);
    assert.ok(pruned);
    const toolContents = (pruned as M[]).filter((m) => m.role === "tool").map((m) => m.content);
    assert.ok(toolContents.includes("tool failed with error"), "ошибка сохранена");
    // 8 не-ошибочных (r1..r7 + r9) + 1 ошибочный = 9 tool-сообщений.
    assert.equal(toolContents.length, 9);
    assert.ok(toolContents.includes("r9"));
    assert.ok(!toolContents.includes("r0"), "самый старый не-ошибочный вычищен");
  });

  it("содержимое-объект сериализуется для проверки ошибок", () => {
    const messages: M[] = [
      { role: "user", content: "hi" },
      ...toolResults(8),
      { role: "tool", content: { text: "exception occurred" } },
      { role: "tool", content: "r9" },
    ];
    const pruned = pruneAgentToolResults(messages, ON);
    assert.ok(pruned);
    const kept = (pruned as M[]).filter((m) => m.role === "tool");
    assert.ok(kept.some((m) => JSON.stringify(m.content).includes("exception")));
    // 8 не-ошибочных + 1 ошибочный = 9 tool-сообщений.
    assert.equal(kept.length, 9);
  });
});
