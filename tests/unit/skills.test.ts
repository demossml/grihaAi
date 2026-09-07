import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverSkills, formatSkillsForPrompt } from "../../src/utils/skills.js";

let root: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "grish-ai-skills-"));

  await fs.mkdir(path.join(root, "core"), { recursive: true });
  await fs.writeFile(
    path.join(root, "core", "SKILL.md"),
    `---
name: core
description: Core office assistant
tags: [assistant, office]
---
# Core
`,
  );

  await fs.mkdir(path.join(root, "report-writer"), { recursive: true });
  await fs.writeFile(
    path.join(root, "report-writer", "SKILL.md"),
    `---
name: report-writer
description: Writes reports
version: 1.2
tags:
  - writing
  - documents
autoCreated: true
---
# Report writer
`,
  );

  await fs.mkdir(path.join(root, "outer", "inner"), { recursive: true });
  await fs.writeFile(
    path.join(root, "outer", "inner", "SKILL.md"),
    `---
name: nested-skill
description: Nested skill
---
# Nested
`,
  );
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("discoverSkills", () => {
  it("discovers skills recursively from SKILL.md files", async () => {
    const skills = await discoverSkills(root);
    const names = skills.map((s) => s.name).sort();
    assert.deepEqual(names, ["core", "nested-skill", "report-writer"]);
  });

  it("supports the autoCreated flag", async () => {
    const skills = await discoverSkills(root);
    const auto = skills.find((s) => s.name === "report-writer");
    assert.equal(auto?.autoCreated, true);
    assert.deepEqual(auto?.tags, ["writing", "documents"]);
    assert.equal(auto?.version, "1.2");

    const core = skills.find((s) => s.name === "core");
    assert.equal(core?.autoCreated, undefined);
    assert.deepEqual(core?.tags, ["assistant", "office"]);
  });

  it("formats skills for a prompt", async () => {
    const skills = await discoverSkills(root);
    const text = formatSkillsForPrompt(skills);
    assert.match(text, /report-writer/);
    assert.match(text, /autoCreated/);
    assert.match(text, /Writes reports/);
  });
});
