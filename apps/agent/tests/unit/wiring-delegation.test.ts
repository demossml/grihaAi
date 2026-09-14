import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createRealSubAgentRunner } from "../../.pi/extensions/multi-agent/RealSubAgentRunner.js";
import type { SubAgentRunTask } from "../../.pi/extensions/multi-agent/SubAgentManager.js";

/**
 * W6 (матрица H4) — delegation gate в createRealSubAgentRunner за флагом
 * GRIHA_AGENT_RUNTIME. Flag off = поведение 1:1 со старым (никакого
 * гейтинга). Flag on = DelegationGuard (depth/timeout/budget) до запуска +
 * проверка таймаута после.
 */

interface FakeSession {
  disposeCalls: number;
  steerCalls: number;
  subscribe(cb: (event: unknown) => void): () => void;
  prompt(_msg: string, _opts?: unknown): Promise<void>;
  dispose(): void;
  steer(_msg: string): Promise<void>;
  getLastAssistantText(): string;
}

function makeFakeSession(): FakeSession {
  let cb: ((event: unknown) => void) | null = null;
  return {
    disposeCalls: 0,
    steerCalls: 0,
    subscribe(fn) {
      cb = fn;
      return () => {};
    },
    prompt(_msg, _opts) {
      // Эмулируем завершение runPrompt: agent_end без retry.
      queueMicrotask(() => cb?.({ type: "agent_end", willRetry: false }));
      return Promise.resolve();
    },
    dispose() {
      this.disposeCalls += 1;
    },
    steer() {
      this.steerCalls += 1;
      return Promise.resolve();
    },
    getLastAssistantText() {
      return "ok";
    },
  };
}

function makeTask(): SubAgentRunTask {
  return {
    goal: "проанализируй отчёт",
    subtreeSessionId: "subtree-1",
    signal: new AbortController().signal,
  };
}

function makeRunner(
  env: Record<string, string>,
  fake: FakeSession,
  extra?: {
    delegationLimits?: { budgetTokens?: number; timeoutMs?: number };
    now?: () => number;
  },
) {
  return createRealSubAgentRunner({
    env,
    sessionFactory: async () => fake as unknown as AgentSession,
    ...extra,
  });
}

describe("wiring: delegation gate в createRealSubAgentRunner (W6/H4)", () => {
  it("flag off: результат проходит как есть, dispose вызван", async () => {
    const fake = makeFakeSession();
    const runner = makeRunner({}, fake);
    const res = await runner(makeTask());
    assert.equal(res.result, "ok");
    assert.equal(fake.disposeCalls, 1);
  });

  it("flag on: обычный результат проходит", async () => {
    const fake = makeFakeSession();
    const runner = makeRunner({ GRIHA_AGENT_RUNTIME: "1" }, fake);
    const res = await runner(makeTask());
    assert.equal(res.result, "ok");
    assert.equal(fake.disposeCalls, 1);
  });

  it("flag on + превышение бюджета токенов: блокировка до запуска", async () => {
    const fake = makeFakeSession();
    const runner = makeRunner({ GRIHA_AGENT_RUNTIME: "1" }, fake, {
      delegationLimits: { budgetTokens: 4 },
    });
    await assert.rejects(
      () => runner(makeTask()),
      /delegation blocked: budget exceeded/,
    );
    assert.equal(fake.disposeCalls, 1);
  });

  it("flag on + превышение таймаута после выполнения", async () => {
    const fake = makeFakeSession();
    let t = 0;
    const runner = makeRunner({ GRIHA_AGENT_RUNTIME: "1" }, fake, {
      now: () => t,
      delegationLimits: { timeoutMs: 1000 },
    });
    const p = runner(makeTask());
    // После старта «прошло» больше таймаута.
    t = 1001;
    await assert.rejects(p, /delegation timeout: 1001ms >= 1000ms/);
    assert.equal(fake.disposeCalls, 1);
  });
});

