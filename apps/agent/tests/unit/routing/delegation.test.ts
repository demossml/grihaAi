import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDelegationPlan,
  classifyComplexity,
} from "../../../src/utils/routing/adaptive-router.js";
import {
  SubAgentManager,
  type SubAgentRunner,
} from "../../../.pi/extensions/multi-agent/SubAgentManager.js";
import { SqliteRagMemoryService } from "../../../.pi/extensions/sqlite-rag-memory/MemoryService.js";
import type { SharedInsight } from "../../../src/types/index.js";
import { cleanTestDb, getTestDbPath } from "../../setup.js";

const stubInsights = {
  async addInsight(insight: Omit<SharedInsight, "id" | "createdAt">): Promise<SharedInsight> {
    return { id: "test", content: insight.content, createdAt: new Date().toISOString() };
  },
};

describe("adaptive router", () => {
  it("classifyComplexity distinguishes simple from complex", async () => {
    const simple = await classifyComplexity("Забронируй встречу на завтра в 10 утра");
    assert.equal(simple.complexity, "simple");

    const complex = await classifyComplexity(
      "Сравни два отчёта и подготовь сводку, а также разошли её команде и собери обратную связь",
    );
    assert.equal(complex.complexity, "complex");
  });

  it("buildDelegationPlan returns >1 task for a complex task", async () => {
    const plan = await buildDelegationPlan("Сравни два отчёта и подготовь сводку", async () =>
      JSON.stringify({
        tasks: [
          { goal: "Сравнить отчёты", role: "analyst" },
          { goal: "Подготовить сводку", role: "writer" },
        ],
      }),
    );
    assert.equal(plan.complexity, "complex");
    assert.ok(plan.tasks.length > 1);
  });

  it("buildDelegationPlan returns no tasks for a simple task", async () => {
    const plan = await buildDelegationPlan("Забронируй встречу", async () => "{}");
    assert.equal(plan.complexity, "simple");
    assert.equal(plan.tasks.length, 0);
  });
});

describe("sub-agent manager", () => {
  const runner: SubAgentRunner = async (task) => ({ result: `done:${task.goal}` });

  it("creates different subtreeSessionId for different tasks", async () => {
    const manager = new SubAgentManager(stubInsights, runner);
    const r1 = await manager.runOne({ goal: "a", parentSessionId: "p1" });
    const r2 = await manager.runOne({ goal: "b", parentSessionId: "p1" });
    assert.notEqual(r1.subtreeSessionId, r2.subtreeSessionId);
  });

  it("returns the result to the parent after completion", async () => {
    const manager = new SubAgentManager(stubInsights, runner);
    const r = await manager.runOne({ goal: "собрать данные", parentSessionId: "parent-1" });
    assert.equal(r.result, "done:собрать данные");
    assert.equal(manager.getTask(r.taskId)?.status, "completed");
  });
});

describe("shared insights", () => {
  it("saves and finds insights via search", async () => {
    const db = "delegation-insights.sqlite";
    cleanTestDb(db);
    const svc = new SqliteRagMemoryService();
    await svc.init(getTestDbPath(db));
    try {
      await svc.addInsight({ content: "Лучший поставщик канцтоваров — ООО Бумага" });
      const res = await svc.searchInsights("поставщик");
      assert.ok(res.length >= 1);
      assert.equal(res[0].content, "Лучший поставщик канцтоваров — ООО Бумага");
    } finally {
      await svc.close();
      cleanTestDb(db);
    }
  });
});
