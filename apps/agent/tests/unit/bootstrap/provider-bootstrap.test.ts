import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyConfig } from "../../../src/utils/bootstrap/provider-bootstrap.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GrishAiConfig } from "@griha/shared-types";

const cfg: GrishAiConfig = {
  version: 1,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-test",
  setupCompletedAt: "2026-09-08T00:00:00.000Z",
};

function mocks(found: boolean) {
  const providers: Array<{ name: string; opts: unknown }> = [];
  let setModelCalls = 0;
  const pi = {
    registerProvider: (name: string, opts: unknown) => providers.push({ name, opts }),
    setModel: async () => {
      setModelCalls++;
      return true;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    modelRegistry: { find: () => (found ? { id: cfg.model } : null) },
    ui: { notify: () => {} },
  } as unknown as ExtensionContext;
  return { pi, ctx, providers, setModelCalls: () => setModelCalls };
}

describe("applyConfig", () => {
  it("регистрирует провайдера с ключом из config.json и активирует модель", async () => {
    const m = mocks(true);
    const ok = await applyConfig(m.pi, m.ctx, cfg);
    assert.equal(ok, true);
    assert.equal(m.providers.length, 1);
    assert.equal(m.providers[0].name, "deepseek");
    assert.equal((m.providers[0].opts as { apiKey?: string }).apiKey, "sk-test");
    assert.equal(m.setModelCalls(), 1);
  });

  it("возвращает false и не вызывает setModel, если модель не найдена", async () => {
    const m = mocks(false);
    const ok = await applyConfig(m.pi, m.ctx, cfg);
    assert.equal(ok, false);
    assert.equal(m.setModelCalls(), 0);
  });
});
