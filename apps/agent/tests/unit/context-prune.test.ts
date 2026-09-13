/**
 * Item 3.3 (C3): pruneToolResults — инварианты очистки.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pruneToolResults,
  type ChatMessage,
} from "../../src/runtime/context/prune.js";

const tool = (content: string): ChatMessage => ({ role: "tool", content });
const msg = (role: string, content: string): ChatMessage => ({ role, content });

describe("pruneToolResults (Item 3.3)", () => {
  it("не-tool сообщения не трогаются", () => {
    const input = [msg("system", "s"), msg("user", "u"), msg("assistant", "a")];
    assert.deepEqual(pruneToolResults(input, { maxToolResults: 1, keepErrorResults: false }), input);
  });

  it("старые tool-результаты сверх лимита вычищаются, свежие остаются", () => {
    const input = [
      tool("r1"),
      tool("r2"),
      tool("r3"),
    ];
    const out = pruneToolResults(input, { maxToolResults: 1, keepErrorResults: false });
    assert.deepEqual(out.map((m) => m.content), ["r3"]);
  });

  it("ошибки сохраняются независимо от лимита", () => {
    const input = [
      tool("error: failed to fetch"),
      tool("ok1"),
      tool("ok2"),
    ];
    const out = pruneToolResults(input, { maxToolResults: 1, keepErrorResults: true });
    assert.deepEqual(out.map((m) => m.content), ["error: failed to fetch", "ok2"]);
  });

  it("ошибки тоже вычищаются при keepErrorResults: false", () => {
    const input = [tool("error: x"), tool("ok")];
    const out = pruneToolResults(input, { maxToolResults: 1, keepErrorResults: false });
    assert.deepEqual(out.map((m) => m.content), ["ok"]);
  });

  it("порядок сообщений сохраняется", () => {
    const input = [msg("user", "u1"), tool("t1"), msg("assistant", "a1"), tool("t2"), msg("user", "u2")];
    const out = pruneToolResults(input, { maxToolResults: 1, keepErrorResults: false });
    assert.deepEqual(out.map((m) => m.content), ["u1", "a1", "t2", "u2"]);
  });

  it("в пределах лимита — без изменений (та же ссылка)", () => {
    const input = [tool("t1"), tool("t2")];
    const out = pruneToolResults(input, { maxToolResults: 5, keepErrorResults: false });
    assert.equal(out, input);
  });
});
