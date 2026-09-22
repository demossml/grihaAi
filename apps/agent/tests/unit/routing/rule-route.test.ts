import { test } from "node:test";
import assert from "node:assert/strict";
import { tryRuleRoute } from "../../../src/runtime/routing/rule-route.js";

test("hasImage → vision", () => {
  const d = tryRuleRoute({ userText: "", hasImage: true });
  assert.ok(d);
  assert.equal(d.role, "vision");
  assert.equal(d.kind, "vision_ocr");
  assert.equal(d.source, "rule");
});

test("текст с «отчёт»/«расход» → report_dispatch flash", () => {
  const d = tryRuleRoute({ userText: "подведи итог расходов за неделю" });
  assert.ok(d);
  assert.equal(d.role, "flash");
  assert.equal(d.kind, "report_dispatch");
  assert.equal(d.complexity, "trivial");
});

test("short text ≤40 → flash trivial", () => {
  const d = tryRuleRoute({ userText: "привет" });
  assert.ok(d);
  assert.equal(d.role, "flash");
  assert.equal(d.kind, "chat_reply");
  assert.equal(d.complexity, "trivial");
});

test("«проанализируй» → main complex", () => {
  const d = tryRuleRoute({
    userText: "проанализируй пожалуйста динамику продаж за последний месяц подробно",
  });
  assert.ok(d);
  assert.equal(d.role, "main");
  assert.equal(d.complexity, "complex");
  assert.equal(d.kind, "analysis");
});

test("empty/unknown long text → tryRuleRoute null", () => {
  const d = tryRuleRoute({
    userText:
      "просто длинное сообщение без ключевых слов о погоде и планах на выходные в ближайшее время",
  });
  assert.equal(d, null);
});
