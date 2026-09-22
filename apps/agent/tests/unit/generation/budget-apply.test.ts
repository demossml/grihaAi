import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelRouter, type GenerationParams } from "../../../src/utils/routing/model-router.js";
import type { GrishAiConfig } from "@griha/shared-types";

const CONFIG = {
  version: 1,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  setupCompletedAt: "2026-01-01T00:00:00Z",
} as GrishAiConfig;

const DECISION = {
  role: "main",
  complexity: "medium",
  kind: "chat_reply",
  confidence: 0.9,
  source: "rule",
  reason: "x",
} as const;

test("policy on → caller received maxTokens === budget.initialMaxTokens", async () => {
  const calls: Array<GenerationParams | undefined> = [];
  const caller = async (
    _config: unknown,
    _messages: unknown,
    gen?: GenerationParams,
  ) => {
    calls.push(gen);
    return "ok";
  };
  const router = new ModelRouter(
    CONFIG,
    caller as never,
    { GRIHA_GENERATION_POLICY: "1" },
  );
  await router.callWithDecision(DECISION, [{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]);
  assert.equal(calls[0]!.maxTokens, 1024); // medium initialMaxTokens
  assert.equal(calls[0]!.temperature, 0.5);
});

test("policy off → caller not forced (gen undefined)", async () => {
  const calls: Array<GenerationParams | undefined> = [];
  const caller = async (
    _config: unknown,
    _messages: unknown,
    gen?: GenerationParams,
  ) => {
    calls.push(gen);
    return "ok";
  };
  const router = new ModelRouter(CONFIG, caller as never, {});
  await router.callWithDecision(DECISION, [{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined);
});
