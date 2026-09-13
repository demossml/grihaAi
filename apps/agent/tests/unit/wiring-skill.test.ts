/**
 * Wiring W4: skill versioning в applySkillProposal за флагом (F3).
 * Flag off = старое поведение (прямая запись SKILL.md).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applySkillProposal } from "../../src/utils/learning/skill-improver.js";

function tmpRoot(): string {
  const dir = path.join(os.tmpdir(), `w4-${randomUUID()}`);
  fs.mkdirSync(path.join(dir, "core"), { recursive: true });
  fs.writeFileSync(path.join(dir, "core", "SKILL.md"), "# Core\n## Базовое\n", "utf8");
  return dir;
}

const proposal = {
  id: "p1",
  kind: "core-edit" as const,
  title: "Новая процедура",
  content: "Шаги:\n1. сделать",
  status: "pending" as const,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("Skill versioning wiring (W4)", () => {
  it("flag off: SKILL.md обновляется напрямую (старое поведение)", async () => {
    const root = tmpRoot();
    try {
      const target = await applySkillProposal(proposal, root, { env: {} });
      assert.ok(target.endsWith("SKILL.md"));
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes("## Новая процедура"));
      assert.ok(!fs.existsSync(path.join(root, "core", ".versions")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flag on: SKILL.md НЕ меняется, создаётся версия в .versions (F3)", async () => {
    const root = tmpRoot();
    try {
      const versionFile = await applySkillProposal(proposal, root, { env: { HERMES_AGENT_RUNTIME: "1" } });
      assert.ok(versionFile.includes(".versions"));
      assert.equal(fs.readFileSync(path.join(root, "core", "SKILL.md"), "utf8"), "# Core\n## Базовое\n");
      const versionContent = fs.readFileSync(versionFile, "utf8");
      assert.ok(versionContent.includes("## Новая процедура"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flag on: повторный propose создаёт следующую версию", async () => {
    const root = tmpRoot();
    try {
      const v2 = await applySkillProposal(proposal, root, { env: { HERMES_AGENT_RUNTIME: "1" } });
      const v3 = await applySkillProposal(
        { ...proposal, id: "p2", title: "Ещё одна процедура" },
        root,
        { env: { HERMES_AGENT_RUNTIME: "1" } },
      );
      assert.ok(v2.endsWith("v2.md"));
      assert.ok(v3.endsWith("v3.md"));
      assert.ok(fs.existsSync(v2) && fs.existsSync(v3));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("new-skill: поведение без изменений (создание нового скилла)", async () => {
    const root = tmpRoot();
    try {
      const created = await applySkillProposal(
        { ...proposal, kind: "new-skill", name: "reports", description: "Отчёты" },
        root,
        { env: { HERMES_AGENT_RUNTIME: "1" } },
      );
      assert.ok(created.endsWith(path.join("reports", "SKILL.md")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
