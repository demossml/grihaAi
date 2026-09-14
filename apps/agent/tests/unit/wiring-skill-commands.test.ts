/**
 * F7 (post-wiring) — slash-команды по скиллам.
 * Frontmatter `commands:` (строка/flow/block) → SkillMeta.commands →
 * collectSkillCommands (валидация, дедуп, слэш-префикс). Off = без команд.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverSkills, type SkillMeta } from "@griha/skills";
import { collectSkillCommands } from "../../.pi/extensions/core-agent/skill-commands.js";

function skill(partial: Partial<SkillMeta>): SkillMeta {
  return {
    name: "core",
    description: "базовый скилл",
    path: "/tmp/core/SKILL.md",
    ...partial,
  };
}

describe("F7: slash-команды по скиллам", () => {
  it("collectSkillCommands: слэш-префикс + описание скилла", () => {
    const commands = collectSkillCommands([
      skill({ name: "report", description: "делает отчёт", commands: ["report"] }),
    ]);
    assert.deepEqual(commands, [
      { name: "/report", skillName: "report", description: "делает отчёт" },
    ]);
  });

  it("невалидные имена отбрасываются (пробелы, длина, символы)", () => {
    const commands = collectSkillCommands([
      skill({ commands: ["ok_name", "has space", "A".repeat(40), "", "русские"] }),
    ]);
    assert.deepEqual(commands.map((c) => c.name), ["/ok_name"]);
  });

  it("дедуп по имени: первый скилл выигрывает", () => {
    const commands = collectSkillCommands([
      skill({ name: "first", commands: ["shared"] }),
      skill({ name: "second", commands: ["shared"] }),
    ]);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.skillName, "first");
  });

  it("discoverSkills: commands из flow-списка, строки и block-списка", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-f7-"));
    try {
      await fs.mkdir(path.join(root, "a"), { recursive: true });
      await fs.mkdir(path.join(root, "b"), { recursive: true });
      await fs.mkdir(path.join(root, "c"), { recursive: true });
      await fs.writeFile(
        path.join(root, "a", "SKILL.md"),
        "---\nname: flow\ndescription: d1\ncommands: [report, draft]\n---\nbody\n",
      );
      await fs.writeFile(
        path.join(root, "b", "SKILL.md"),
        "---\nname: single\ndescription: d2\ncommands: digest\n---\nbody\n",
      );
      await fs.writeFile(
        path.join(root, "c", "SKILL.md"),
        "---\nname: block\ndescription: d3\ncommands:\n  - one\n  - two\n---\nbody\n",
      );
      const skills = await discoverSkills(root);
      const byName = new Map(skills.map((s) => [s.name, s.commands ?? []]));
      assert.deepEqual(byName.get("flow"), ["report", "draft"]);
      assert.deepEqual(byName.get("single"), ["digest"]);
      assert.deepEqual(byName.get("block"), ["one", "two"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("скилл без commands → undefined (ничего не регистрируется)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-f7b-"));
    try {
      await fs.writeFile(
        path.join(root, "SKILL.md"),
        "---\nname: plain\ndescription: d\n---\nbody\n",
      );
      const skills = await discoverSkills(root);
      assert.equal(skills.length, 1);
      assert.equal(skills[0]!.commands, undefined);
      assert.equal(collectSkillCommands(skills).length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
