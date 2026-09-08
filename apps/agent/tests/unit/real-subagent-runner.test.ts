import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRealSubAgentRunner } from "../../.pi/extensions/multi-agent/RealSubAgentRunner.js";
import type { SubAgentRunTask } from "../../.pi/extensions/multi-agent/SubAgentManager.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type Listener = (event: unknown) => void;

class FakeAgentSession {
  listeners: Listener[] = [];
  prompts: string[] = [];
  steered: string[] = [];
  lastText = "";
  disposed = false;
  /** When false, prompt() does not auto-finish — tests drive the end manually. */
  autoFinish = true;

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  emit(event: unknown): void {
    for (const l of [...this.listeners]) l(event);
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    if (this.autoFinish) {
      this.lastText = `ответ на: ${message}`;
      this.emit({ type: "agent_end", messages: [], willRetry: false });
    }
  }

  async steer(message: string): Promise<void> {
    this.steered.push(message);
  }

  getLastAssistantText(): string {
    return this.lastText;
  }

  get isStreaming(): boolean {
    return false;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function makeTask(overrides: Partial<SubAgentRunTask> = {}): SubAgentRunTask {
  return {
    goal: "goal",
    subtreeSessionId: "sub-1",
    signal: new AbortController().signal,
    ...overrides,
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("real sub-agent runner", () => {
  it("returns the last assistant text and disposes the session", async () => {
    const fake = new FakeAgentSession();
    const runner = createRealSubAgentRunner({
      sessionFactory: async () => fake as unknown as AgentSession,
    });

    const result = await runner(makeTask({ goal: "собери данные" }));

    assert.equal(result.result, "ответ на: собери данные");
    assert.equal(fake.disposed, true);
  });

  it("passes subtreeSessionId to the session factory (isolation key)", async () => {
    const seen: string[] = [];
    const runner = createRealSubAgentRunner({
      sessionFactory: async (task) => {
        seen.push(task.subtreeSessionId);
        return new FakeAgentSession() as unknown as AgentSession;
      },
    });

    await runner(makeTask({ subtreeSessionId: "sub-aaa" }));
    await runner(makeTask({ subtreeSessionId: "sub-bbb" }));

    assert.deepEqual(seen, ["sub-aaa", "sub-bbb"]);
  });

  it("reports partial assistant text via onPartial", async () => {
    const fake = new FakeAgentSession();
    fake.autoFinish = false;
    const runner = createRealSubAgentRunner({
      sessionFactory: async () => fake as unknown as AgentSession,
    });

    const partials: string[] = [];
    const promise = runner(
      makeTask({
        goal: "g",
        onPartial: (text) => partials.push(text),
      }),
    );

    await tick();
    fake.emit({
      type: "entry_appended",
      entry: {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "частичный результат" },
            { type: "toolCall", id: "t", name: "read", arguments: {} },
          ],
        },
      },
    });
    fake.lastText = "полный результат";
    fake.emit({ type: "agent_end", messages: [], willRetry: false });

    const result = await promise;
    assert.deepEqual(partials, ["частичный результат"]);
    assert.equal(result.result, "полный результат");
  });

  it("delivers steer redirects to the running session", async () => {
    const fake = new FakeAgentSession();
    fake.autoFinish = false;
    let capturedTask: SubAgentRunTask | null = null;
    const runner = createRealSubAgentRunner({
      sessionFactory: async (task) => {
        capturedTask = task;
        return fake as unknown as AgentSession;
      },
    });

    const promise = runner(makeTask({ goal: "g" }));

    // The runner assigns task.onSteer right after the factory resolves.
    await tick();
    const task = capturedTask as unknown as SubAgentRunTask;
    assert.ok(task.onSteer, "onSteer should be assigned by the runner");
    task.onSteer!("focus finance");

    await tick();
    assert.deepEqual(fake.steered, ["focus finance"]);

    fake.lastText = "done";
    fake.emit({ type: "agent_end", messages: [], willRetry: false });
    const result = await promise;
    assert.equal(result.result, "done");
  });

  it("resolves early when the signal is aborted", async () => {
    const fake = new FakeAgentSession();
    fake.autoFinish = false;
    const controller = new AbortController();
    const runner = createRealSubAgentRunner({
      sessionFactory: async () => fake as unknown as AgentSession,
    });

    const promise = runner(makeTask({ signal: controller.signal }));

    await tick();
    controller.abort();

    const result = await promise;
    assert.equal(result.result, "");
    assert.equal(fake.disposed, true);
  });
});
