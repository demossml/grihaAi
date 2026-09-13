/**
 * Item 10.2 (J2): AutomationEngine — one-shot/recurring, pause/resume/remove,
 * agent и script jobs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAutomationEngine,
  type AutomationRunners,
} from "../../src/runtime/automation/engine.js";

const runners = (): AutomationRunners & { agentRuns: string[]; scriptRuns: string[] } => {
  const agentRuns: string[] = [];
  const scriptRuns: string[] = [];
  return {
    agentRuns,
    scriptRuns,
    runAgent: async (job) => {
      agentRuns.push(job.id);
    },
    runScript: async (job) => {
      scriptRuns.push(job.id);
    },
    now: () => "2026-01-01T00:00:00Z",
    idFactory: () => `j${agentRuns.length + scriptRuns.length + 1}`,
  };
};

describe("AutomationEngine (Item 10.2)", () => {
  it("create/run: recurring agent-job → idle после прогона", async () => {
    const r = runners();
    const engine = new InMemoryAutomationEngine(r);
    const id = await engine.create({
      name: "daily",
      kind: "recurring",
      schedule: "every day",
      prompt: "summarize",
      runAs: "agent",
    });
    await engine.run(id);
    assert.deepEqual(r.agentRuns, [id]);
    assert.equal(engine.get(id)?.status, "idle");
    assert.equal(engine.get(id)?.lastRunAt, "2026-01-01T00:00:00Z");
  });

  it("one-shot → done после первого прогона", async () => {
    const engine = new InMemoryAutomationEngine(runners());
    const id = await engine.create({ name: "once", kind: "one-shot", prompt: "p", runAs: "agent" });
    await engine.run(id);
    assert.equal(engine.get(id)?.status, "done");
  });

  it("pause/resume: paused не запускается, resume → idle", async () => {
    const engine = new InMemoryAutomationEngine(runners());
    const id = await engine.create({ name: "job", kind: "recurring", prompt: "p", runAs: "agent" });
    await engine.pause(id);
    await assert.rejects(engine.run(id), /paused/);
    await engine.resume(id);
    assert.equal(engine.get(id)?.status, "idle");
    await engine.run(id);
    assert.equal(engine.get(id)?.status, "idle");
  });

  it("script job (no-agent) выполняется без LLM (J4)", async () => {
    const r = runners();
    const engine = new InMemoryAutomationEngine(r);
    const id = await engine.create({
      name: "backup",
      kind: "one-shot",
      runAs: "script",
      script: { command: "rsync", timeoutMs: 1000, maxOutputChars: 100 },
    });
    await engine.run(id);
    assert.deepEqual(r.scriptRuns, [id]);
    assert.deepEqual(r.agentRuns, []);
    assert.equal(engine.get(id)?.status, "done");
  });

  it("ошибка runner'а → failed с lastError", async () => {
    const engine = new InMemoryAutomationEngine({
      runAgent: async () => {
        throw new Error("boom");
      },
    });
    const id = await engine.create({ name: "x", kind: "recurring", prompt: "p", runAs: "agent" });
    await engine.run(id);
    assert.equal(engine.get(id)?.status, "failed");
    assert.equal(engine.get(id)?.lastError, "boom");
  });

  it("remove удаляет job; несуществующий id → ошибка", async () => {
    const engine = new InMemoryAutomationEngine(runners());
    const id = await engine.create({ name: "x", kind: "one-shot", prompt: "p", runAs: "agent" });
    await engine.remove(id);
    assert.equal(engine.get(id), undefined);
    await assert.rejects(engine.remove("missing"), /not found/);
  });

  it("валидация при create: script без spec / agent без prompt", async () => {
    const engine = new InMemoryAutomationEngine(runners());
    await assert.rejects(
      engine.create({ name: "s", kind: "one-shot", runAs: "script" }),
      /script spec/,
    );
    await assert.rejects(
      engine.create({ name: "a", kind: "one-shot", runAs: "agent" }),
      /prompt/,
    );
  });
});
