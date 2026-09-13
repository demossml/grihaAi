import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activateSkillProposal,
  applySkillProposal,
  rollbackSkillVersion,
  type SkillProposal,
} from "../../src/utils/learning/skill-improver.js";

/**
 * F3 (матрица F3, §14) — активное переключение версий скиллов за флагом.
 * Off = прямое применение (1:1). On = propose → version-файл, активация
 * через quality-gate (хуже-версия не активируется), rollback к предыдущей.
 */

const ON = { HERMES_AGENT_RUNTIME: "1" };

function makeRoot(): { root: string; coreFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-f3-"));
  const coreDir = path.join(root, "core");
  fs.mkdirSync(coreDir, { recursive: true });
  const coreFile = path.join(coreDir, "SKILL.md");
  fs.writeFileSync(coreFile, "---\nname: core\n---\n# Core\n", "utf8");
  return { root, coreFile };
}

function proposal(title: string, content: string): SkillProposal {
  return {
    id: "p1",
    kind: "core-edit",
    title,
    content,
    status: "pending",
    createdAt: "2026-09-13T00:00:00Z",
  };
}

describe("F3: версии скиллов (propose → activate → rollback)", () => {
  it("flag off: прямое применение, без .versions", async () => {
    const { root, coreFile } = makeRoot();
    try {
      const target = await applySkillProposal(proposal("Правило", "Делай так."), root, { env: {} });
      assert.equal(target, coreFile);
      const content = fs.readFileSync(coreFile, "utf8");
      assert.match(content, /Делай так\./);
      assert.equal(fs.existsSync(path.join(root, "core", ".versions")), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flag on: propose не меняет активный SKILL.md", async () => {
    const { root, coreFile } = makeRoot();
    try {
      const versionFile = await applySkillProposal(proposal("Правило", "Делай так."), root, { env: ON });
      assert.ok(versionFile.includes(".versions"));
      const content = fs.readFileSync(coreFile, "utf8");
      assert.ok(!content.includes("Делай так."), "активный файл не меняется");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flag on: активация переключает SKILL.md и пишет active.txt", async () => {
    const { root, coreFile } = makeRoot();
    try {
      await applySkillProposal(proposal("Правило", "Делай так."), root, { env: ON });
      const target = await activateSkillProposal(proposal("Правило", "Делай так."), root, { env: ON });
      assert.equal(target, coreFile);
      const content = fs.readFileSync(coreFile, "utf8");
      assert.match(content, /Делай так\./);
      const marker = fs.readFileSync(path.join(root, "core", ".versions", "active.txt"), "utf8");
      // In-process кэш store сдвигает номера (propose + activate) — маркер ≥ 2.
      assert.ok(Number(marker.trim()) >= 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flag on: quality-gate — низкий score не активируется", async () => {
    const { root } = makeRoot();
    try {
      await applySkillProposal(proposal("Правило", "Делай так."), root, { env: ON });
      await assert.rejects(
        () => activateSkillProposal(proposal("Правило", "Делай так."), root, { env: ON, qualityScore: 0.1 }),
        /evaluation not passed/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flag on: rollback возвращает предыдущую версию (кросс-процессный сценарий)", async () => {
    const { root, coreFile } = makeRoot();
    try {
      // Эмулируем историю: v1 (база), v2 (кандидат), активна v2.
      const versionsDir = path.join(root, "core", ".versions");
      fs.mkdirSync(versionsDir, { recursive: true });
      const base = "---\nname: core\n---\n# Core\n";
      fs.writeFileSync(path.join(versionsDir, "v1.md"), base, "utf8");
      fs.writeFileSync(
        path.join(versionsDir, "v2.md"),
        `${base}\n\n## Правило\n\nДелай так.\n`,
        "utf8",
      );
      fs.writeFileSync(path.join(versionsDir, "active.txt"), "2", "utf8");
      fs.writeFileSync(coreFile, `${base}\n\n## Правило\n\nДелай так.\n`, "utf8");

      const result = await rollbackSkillVersion(root, { env: ON });
      assert.equal(result.ok, true);
      assert.match(result.message, /rolled back to v1/);
      const content = fs.readFileSync(coreFile, "utf8");
      assert.ok(!content.includes("Делай так."), "базовая версия восстановлена");
      const marker = fs.readFileSync(path.join(versionsDir, "active.txt"), "utf8");
      assert.equal(Number(marker.trim()), 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rollback без истории → ok false", async () => {
    const { root } = makeRoot();
    try {
      const result = await rollbackSkillVersion(root, { env: ON });
      assert.equal(result.ok, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flag off: rollback disabled", async () => {
    const { root } = makeRoot();
    try {
      const result = await rollbackSkillVersion(root, { env: {} });
      assert.equal(result.ok, false);
      assert.match(result.message, /disabled/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
