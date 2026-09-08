import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getSkillsRoot } from "./index.js";

describe("getSkillsRoot", () => {
  it("points to an existing directory containing core/SKILL.md", () => {
    const root = getSkillsRoot();
    assert.equal(fs.existsSync(root), true);
    assert.equal(fs.existsSync(path.join(root, "core", "SKILL.md")), true);
  });
});
