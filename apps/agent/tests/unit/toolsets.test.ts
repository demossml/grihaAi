/**
 * Item 12.2 (L2/§23): toolsets + запрет самодобавления.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canModifyPolicy,
  canUseToolset,
  validateToolsetRequest,
  type ToolsetPolicy,
} from "../../src/runtime/toolsets/toolsets.js";

const policy: ToolsetPolicy = {
  allowed: ["core", "memory", "coding"],
  adminActors: ["owner"],
};

describe("Toolsets (Item 12.2)", () => {
  it("разрешённый toolset → allowed", () => {
    assert.equal(canUseToolset("memory", policy).allowed, true);
  });

  it("не разрешённый toolset → отказ с причиной", () => {
    const decision = canUseToolset("finance", policy);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /не разрешён/);
  });

  it("запрет самодобавления: не-admin не может менять политику", () => {
    assert.equal(canModifyPolicy("owner", policy).allowed, true);
    const llm = canModifyPolicy("llm", policy);
    assert.equal(llm.allowed, false);
    assert.match(llm.reason, /самодобавления/);
  });

  it("validateToolsetRequest: запрос вне политики отклоняется", () => {
    const result = validateToolsetRequest(["core", "finance"], policy, "owner");
    assert.equal(result.allowed, false);
    assert.deepEqual(result.denied, ["finance"]);
  });

  it("validateToolsetRequest: не-admin отклоняется полностью", () => {
    const result = validateToolsetRequest(["core"], policy, "llm");
    assert.equal(result.allowed, false);
    assert.deepEqual(result.denied, ["core"]);
  });

  it("validateToolsetRequest: валидный запрос admin'ом проходит", () => {
    const result = validateToolsetRequest(["core", "memory"], policy, "owner");
    assert.equal(result.allowed, true);
    assert.deepEqual(result.denied, []);
  });
});
