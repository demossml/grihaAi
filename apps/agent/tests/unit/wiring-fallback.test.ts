import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ModelRouter } from "../../src/utils/routing/model-router.js";
import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";

/**
 * B3 (post-wiring, §7) — FallbackChain в ModelRouter.call за флагом.
 * Off = один вызов без fallback (1:1). On = цепочка по политике роли:
 * 429/5xx/network/timeout → следующий кандидат; auth/context/unknown → стоп.
 */

const mainModel: ModelConfig = {
  provider: "primary",
  model: "primary-model",
  apiKey: "k",
};

const fallbackA: ModelConfig = {
  provider: "fallback",
  model: "fallback-a",
  apiKey: "k",
};

const fallbackB: ModelConfig = {
  provider: "fallback",
  model: "fallback-b",
  apiKey: "k",
};

function config(): GrishAiConfig {
  return {
    version: 1,
    provider: "openai",
    model: "primary-model",
    apiKey: "k",
    setupCompletedAt: "2026-09-13T00:00:00Z",
    models: {
      main: mainModel,
      fallbackModels: [fallbackA, fallbackB],
    },
  };
}

const ON = { HERMES_AGENT_RUNTIME: "1" };

const messages = [{ role: "user", content: "hello" }];

function err500(): Error {
  const e = new Error("Internal Server Error") as Error & { status?: number };
  e.status = 500;
  return e;
}

describe("B3: FallbackChain в ModelRouter.call", () => {
  it("flag off: одна попытка, ошибка пробрасывается без fallback", async () => {
    let calls = 0;
    const router = new ModelRouter(config(), async () => {
      calls++;
      throw err500();
    }, {});
    await assert.rejects(() => router.call("main", messages), /Internal Server/);
    assert.equal(calls, 1);
  });

  it("flag on: 5xx на primary → fallback-кандидат отвечает", async () => {
    const order: string[] = [];
    const router = new ModelRouter(config(), async (cfg) => {
      order.push(cfg.model);
      if (cfg.model === "primary-model") throw err500();
      return `ok from ${cfg.model}`;
    }, ON);
    const result = await router.call("main", messages);
    assert.equal(result, "ok from fallback-a");
    assert.deepEqual(order, ["primary-model", "fallback-a"]);
  });

  it("flag on: цепочка из двух fallback-кандидатов (два сбоя)", async () => {
    const order: string[] = [];
    const router = new ModelRouter(config(), async (cfg) => {
      order.push(cfg.model);
      if (cfg.model === "fallback-b") return "last chance";
      throw err500();
    }, ON);
    const result = await router.call("main", messages);
    assert.equal(result, "last chance");
    assert.deepEqual(order, ["primary-model", "fallback-a", "fallback-b"]);
  });

  it("flag on: auth (401) → стоп, fallback не используется", async () => {
    let calls = 0;
    const router = new ModelRouter(config(), async () => {
      calls++;
      const e = new Error("Unauthorized") as Error & { status?: number };
      e.status = 401;
      throw e;
    }, ON);
    await assert.rejects(() => router.call("main", messages), /Unauthorized/);
    assert.equal(calls, 1);
  });

  it("flag on: context-overflow → стоп (нужна компакция, не смена модели)", async () => {
    let calls = 0;
    const router = new ModelRouter(config(), async () => {
      calls++;
      throw new Error("maximum context length exceeded");
    }, ON);
    await assert.rejects(() => router.call("main", messages), /context length/);
    assert.equal(calls, 1);
  });

  it("flag on: все кандидаты падают → последняя ошибка наружу", async () => {
    const router = new ModelRouter(config(), async () => {
      throw new Error("gateway timeout");
    }, ON);
    await assert.rejects(() => router.call("main", messages), /gateway timeout/);
  });

  it("flag on: без fallbackModels в конфиге → единственная попытка", async () => {
    let calls = 0;
    const cfg = config();
    cfg.models = { main: mainModel };
    const router = new ModelRouter(cfg, async () => {
      calls++;
      throw err500();
    }, ON);
    await assert.rejects(() => router.call("main", messages));
    assert.equal(calls, 1);
  });

  it("flag on: vision (allowFallback=false) → без fallback", async () => {
    let calls = 0;
    const cfg = config();
    cfg.models = {
      main: mainModel,
      vision: { provider: "v", model: "vision-model", apiKey: "k" },
      fallbackModels: [fallbackA],
    };
    const router = new ModelRouter(cfg, async () => {
      calls++;
      throw err500();
    }, ON);
    await assert.rejects(() => router.call("vision", messages));
    assert.equal(calls, 1);
  });
});
