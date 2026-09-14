/**
 * Phase 1 (Item 1.1): AgentKernel registry + lifecycle + feature flag.
 * Тесты поведения, а не факта вызова (§8 instr.md).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AgentKernelImpl,
  createAgentKernel,
  isAgentRuntimeEnabled,
  type EngineName,
  type RuntimeEngine,
} from "../../src/runtime/index.js";

function fakeEngine(name: EngineName): RuntimeEngine & {
  initLog: string[];
  disposeLog: string[];
} {
  const initLog: string[] = [];
  const disposeLog: string[] = [];
  return {
    name,
    initLog,
    disposeLog,
    async init() {
      initLog.push(name);
    },
    async dispose() {
      disposeLog.push(name);
    },
  };
}

describe("AgentKernel (Phase 1)", () => {
  it("регистрирует движки и отдаёт по имени", () => {
    const kernel = new AgentKernelImpl();
    const model = fakeEngine("model");
    kernel.register(model);
    assert.equal(kernel.get("model"), model);
    assert.equal(kernel.has("model"), true);
    assert.equal(kernel.has("vision" as EngineName), false);
    assert.equal(kernel.get("memory"), undefined);
  });

  it("дубликат имени → ошибка регистрации (инвариант)", () => {
    const kernel = new AgentKernelImpl();
    kernel.register(fakeEngine("model"));
    assert.throws(() => kernel.register(fakeEngine("model")), /already registered/);
  });

  it("init в порядке регистрации, каждый ровно один раз", async () => {
    const kernel = new AgentKernelImpl();
    const model = fakeEngine("model");
    const memory = fakeEngine("memory");
    const skill = fakeEngine("skill");
    kernel.register(model);
    kernel.register(memory);
    kernel.register(skill);
    await kernel.init({ enabled: true });
    assert.deepEqual(model.initLog, ["model"]);
    assert.deepEqual(memory.initLog, ["memory"]);
    assert.deepEqual(skill.initLog, ["skill"]);
    await kernel.init({ enabled: true });
    assert.deepEqual(model.initLog, ["model"], "повторный init — no-op");
  });

  it("dispose в обратном порядке", async () => {
    const kernel = new AgentKernelImpl();
    const model = fakeEngine("model");
    const memory = fakeEngine("memory");
    kernel.register(model);
    kernel.register(memory);
    await kernel.init({ enabled: true });
    await kernel.dispose();
    assert.deepEqual(memory.disposeLog, ["memory"]);
    assert.deepEqual(model.disposeLog, ["model"]);
  });

  it("enabled: false → движки НЕ инициализируются (поведение не меняется)", async () => {
    const kernel = new AgentKernelImpl();
    const model = fakeEngine("model");
    kernel.register(model);
    await kernel.init({ enabled: false });
    assert.deepEqual(model.initLog, []);
  });

  it("createAgentKernel регистрирует переданные движки", () => {
    const kernel = createAgentKernel([fakeEngine("model"), fakeEngine("security")]);
    assert.deepEqual(kernel.names(), ["model", "security"]);
  });

  it("feature flag: default off; '1'/'true' → on; '0'/мусор → off", () => {
    assert.equal(isAgentRuntimeEnabled({}), false);
    assert.equal(isAgentRuntimeEnabled({ GRIHA_AGENT_RUNTIME: undefined }), false);
    assert.equal(isAgentRuntimeEnabled({ GRIHA_AGENT_RUNTIME: "1" }), true);
    assert.equal(isAgentRuntimeEnabled({ GRIHA_AGENT_RUNTIME: "TRUE" }), true);
    assert.equal(isAgentRuntimeEnabled({ GRIHA_AGENT_RUNTIME: "true" }), true);
    assert.equal(isAgentRuntimeEnabled({ GRIHA_AGENT_RUNTIME: "0" }), false);
    assert.equal(isAgentRuntimeEnabled({ GRIHA_AGENT_RUNTIME: "yes" }), false);
  });
});
