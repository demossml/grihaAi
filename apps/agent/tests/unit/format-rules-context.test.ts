import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatRulesContext } from "../../.pi/extensions/user-rules/format-rules-context.js";
import type { UserRule } from "@griha/shared-types";

const rule = (key: string, value: string | boolean, kind: "hard" | "soft"): UserRule => ({
  id: `r-${key}`,
  scope: "chat",
  chatId: "-100",
  text: `${key} = ${String(value)}`,
  kind,
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
  key,
  value,
});

describe("formatRulesContext", () => {
  it("включает soft-ключи и hard-сводку", () => {
    const ctx = formatRulesContext(
      [rule("require_mention", true, "hard")],
      [rule("length", "short", "soft")],
    );
    assert.ok(ctx.startsWith("[GROUP_RULES]"));
    assert.ok(ctx.includes("- length=short"));
    assert.ok(ctx.includes("- hard:require_mention=true"));
    assert.ok(ctx.endsWith("[/GROUP_RULES]"));
  });

  it("пустые правила → всё равно шапка контракта", () => {
    const ctx = formatRulesContext([], []);
    assert.ok(ctx.includes("[GROUP_RULES]"));
    assert.ok(ctx.includes("enforced by the system prefilter"));
  });
});
