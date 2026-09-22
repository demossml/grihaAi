import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryRuleRoute } from "../../../src/runtime/routing/rule-route.js";
import { applyRouteGuidance } from "../../../.pi/extensions/telegram-bot/pool-routing.js";

describe("flash contract", () => {
  it("purchases question → report_dispatch", () => {
    const d = tryRuleRoute({
      userText: "Что у нас было по закупкам за прошлую неделю?",
      hostHint: "unknown",
    });
    assert.ok(d);
    assert.equal(d!.kind, "report_dispatch");
    assert.equal(d!.role, "flash");
  });

  it("why expenses → analysis main", () => {
    const d = tryRuleRoute({
      userText: "Почему выросли расходы?",
      hostHint: "unknown",
    });
    assert.ok(d);
    assert.equal(d!.kind, "analysis");
    assert.equal(d!.role, "main");
  });

  it("image → vision", () => {
    const d = tryRuleRoute({
      userText: "",
      hasImage: true,
    });
    assert.ok(d);
    assert.equal(d!.role, "vision");
    assert.equal(d!.kind, "vision_ocr");
  });

  it("applyRouteGuidance injects for report_dispatch", () => {
    const out = applyRouteGuidance("hello", { kind: "report_dispatch" });
    assert.match(out, /\[ROUTE\] report_dispatch/);
    assert.match(out, /hello/);
  });

  it("applyRouteGuidance skips other kinds", () => {
    const out = applyRouteGuidance("hello", { kind: "chat_reply" });
    assert.equal(out, "hello");
  });
});
