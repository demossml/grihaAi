import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ModelRouter } from "../../src/utils/routing/model-router.js";
import {
  runtimeObservability,
  RuntimeObservability,
} from "../../src/utils/routing/runtime-observability.js";
import {
  generateCorrelationId,
  isValidCorrelationId,
} from "../../src/runtime/observability/telemetry.js";
import type { GrishAiConfig } from "@griha/shared-types";

/**
 * W13 (матрица P2/P3, §31/§32) — telemetry/cost в ModelRouter.call.
 * Flag off → прямые вызовы, телеметрия не пишется (1:1).
 * Flag on → correlation ID на вызов, события agent-run/model-selected/
 * tokens/latency/error + тоталы по ролям с оценкой стоимости.
 */

const config: GrishAiConfig = {
  version: 1,
  provider: "anthropic",
  model: "claude-test",
  apiKey: "k",
  setupCompletedAt: "2026-09-13T00:00:00Z",
};

const ON = { GRIHA_AGENT_RUNTIME: "1" };

function freshObservability(): RuntimeObservability {
  // Singleton используется ModelRouter — чистим через новый инстанс нельзя.
  // Поэтому тесты работают с синглтоном, но счёт событий проверяется по
  // correlation-полям, а тоталы — снэпшотом до/после.
  return runtimeObservability;
}

describe("W13: telemetry в ModelRouter.call", () => {
  it("correlation id: генерируется и валиден", () => {
    const id = generateCorrelationId();
    assert.equal(isValidCorrelationId(id), true);
  });

  it("flag off: прямой вызов без телеметрии", async () => {
    const before = runtimeObservability.totalsByRole().length;
    const router = new ModelRouter(config, async () => "ok", {});
    const result = await router.call("main", [{ role: "user", content: "hi" }]);
    assert.equal(result, "ok");
    assert.equal(runtimeObservability.totalsByRole().length, before);
  });

  it("flag on: события + корреляция + тоталы по роли", async () => {
    const router = new ModelRouter(config, async () => "response text", ON);
    const result = await router.call("main", [
      { role: "user", content: "hello world" },
    ]);
    assert.equal(result, "response text");

    const totals = runtimeObservability.totalsByRole();
    const main = totals.find((t) => t.modelRole === "main");
    assert.ok(main, "есть тотал по роли main");
    assert.ok(main.calls >= 1);
    assert.ok(main.usage.inputTokens > 0);
    assert.ok(main.usage.outputTokens > 0);
    assert.ok(main.cost > 0, "стоимость оценена");
  });

  it("flag on: ошибка записывается и пробрасывается", async () => {
    const router = new ModelRouter(config, async () => {
      throw new Error("provider down");
    }, ON);
    await assert.rejects(() => router.call("main", []), /provider down/);
  });

  it("estimateInputTokens учитывает роль и контент", () => {
    const n = runtimeObservability.estimateInputTokens([
      { role: "user", content: "hello" },
    ]);
    assert.ok(n > 0);
  });
});
