/**
 * Item 2.4 (B4): цепочка разрешения контекстного окна.
 * config.contextWindow → каталог model → дефолт провайдера → DEFAULT.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelConfig } from "@griha/shared-types";
import {
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow,
} from "../../src/runtime/model/context-window.js";

const m = (partial: Partial<ModelConfig> = {}): ModelConfig => ({
  provider: "deepseek",
  model: "deepseek-v4-pro",
  ...partial,
});

describe("resolveContextWindow (Item 2.4)", () => {
  it("явный override конфига выигрывает у каталога", () => {
    assert.equal(resolveContextWindow(m({ contextWindow: 64000 })), 64000);
  });

  it("каталог model → окно", () => {
    assert.equal(resolveContextWindow(m({ model: "deepseek-v4-flash" })), 128000);
  });

  it("дефолт провайдера (deepseek)", () => {
    assert.equal(resolveContextWindow(m({ model: "unknown-model" })), 128000);
  });

  it("неизвестный провайдер → DEFAULT_CONTEXT_WINDOW", () => {
    assert.equal(
      resolveContextWindow(m({ provider: "other", model: "x" })),
      DEFAULT_CONTEXT_WINDOW,
    );
  });

  it("некорректный override (0/отрицательный) игнорируется", () => {
    assert.equal(resolveContextWindow(m({ contextWindow: 0 })), 128000);
  });

  it("пользовательский каталог поддерживается (DI)", () => {
    assert.equal(
      resolveContextWindow(m({ model: "my-model" }), { "my-model": 65536 }),
      65536,
    );
  });
});
