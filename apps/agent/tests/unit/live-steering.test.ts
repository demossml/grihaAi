import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SubAgentManager,
  type SubAgentRunner,
} from "../../.pi/extensions/multi-agent/SubAgentManager.js";
import type { SharedInsight } from "../../src/types/index.js";

const stubInsights = {
  async addInsight(insight: Omit<SharedInsight, "id" | "createdAt">): Promise<SharedInsight> {
    return { id: "test", content: insight.content, createdAt: new Date().toISOString() };
  },
};

describe("live steering", () => {
  it("starts a sub-agent and returns its taskId", async () => {
    const runner: SubAgentRunner = async (task) => ({ result: `done:${task.goal}` });
    const manager = new SubAgentManager(stubInsights, runner);
    const handle = manager.start({ goal: "g", parentSessionId: "p" });
    assert.ok(handle.taskId);
    assert.equal(manager.getState(handle.taskId)?.status, "running");
    await manager.waitFor(handle.taskId);
  });

  it("listRunning returns a running task", () => {
    const runner: SubAgentRunner = () => new Promise(() => {});
    const manager = new SubAgentManager(stubInsights, runner);
    const handle = manager.start({ goal: "g", parentSessionId: "p" });
    assert.ok(manager.listRunning().some((s) => s.taskId === handle.taskId));
  });

  it("steer with redirect changes behavior (mock)", async () => {
    const runner: SubAgentRunner = (task) =>
      new Promise((resolve) => {
        task.onSteer = (msg) => resolve({ result: `redirected:${msg}` });
      });
    const manager = new SubAgentManager(stubInsights, runner);
    const handle = manager.start({ goal: "g", parentSessionId: "p" });
    await manager.steer(handle.taskId, {
      taskId: handle.taskId,
      message: "focus finance",
      action: "redirect",
    });
    const result = await manager.waitFor(handle.taskId);
    assert.equal(result.result, "redirected:focus finance");
  });

  it("stop returns partialResult", async () => {
    const runner: SubAgentRunner = (task) =>
      new Promise(() => {
        task.onPartial?.("partial work so far");
      });
    const manager = new SubAgentManager(stubInsights, runner);
    const handle = manager.start({ goal: "g", parentSessionId: "p" });
    const result = await manager.stop(handle.taskId, true);
    assert.equal(result.result, "partial work so far");
  });

  it("status becomes stopped after stop", async () => {
    const runner: SubAgentRunner = () => new Promise(() => {});
    const manager = new SubAgentManager(stubInsights, runner);
    const handle = manager.start({ goal: "g", parentSessionId: "p" });
    await manager.stop(handle.taskId, true);
    assert.equal(manager.getState(handle.taskId)?.status, "stopped");
  });
});
