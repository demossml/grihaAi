/**
 * Item 12.3 (F8): conditional activation скиллов.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alwaysActivatable,
  isSkillActivatable,
} from "../../src/runtime/toolsets/activation.js";

describe("Skill activation (Item 12.3)", () => {
  it("requires доступны → активация через requires", () => {
    const decision = isSkillActivatable({ requires: ["coding"] }, ["core", "coding"]);
    assert.equal(decision.activatable, true);
    assert.equal(decision.via, "requires");
  });

  it("requires недоступны, fallback есть → активация через fallback", () => {
    const decision = isSkillActivatable(
      { requires: ["finance"], fallback: ["coding"] },
      ["core", "coding"],
    );
    assert.equal(decision.activatable, true);
    assert.equal(decision.via, "fallback");
  });

  it("ни requires, ни fallback → не активируется", () => {
    const decision = isSkillActivatable(
      { requires: ["finance"], fallback: ["crm"] },
      ["core"],
    );
    assert.equal(decision.activatable, false);
    assert.equal(decision.via, "none");
  });

  it("Set как available работает", () => {
    const decision = isSkillActivatable({ requires: ["memory"] }, new Set(["memory"]));
    assert.equal(decision.activatable, true);
  });

  it("alwaysActivatable: скилл без требований", () => {
    assert.equal(alwaysActivatable().activatable, true);
  });
});
