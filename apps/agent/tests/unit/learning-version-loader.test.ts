/**
 * L5 — active skill version loader + deterministic evaluation + rollback.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activateSkillProposal,
  applySkillProposal,
  getActiveSkillBody,
  getActiveSkillVersion,
  rollbackSkill,
  type SkillProposal,
} from "../../src/utils/learning/skill-improver.js";
import { evaluateCandidate } from "../../src/runtime/learning/skill-evaluation.js";
import { SkillQualityTracker } from "../../src/runtime/learning/quality.js";

const ON = { GRIHA_AGENT_RUNTIME: "1" };

function makeRoot(): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-l5-"));
  const coreDir = path.join(root, "core");
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(path.join(coreDir, "SKILL.md"), "# Core v1\n", "utf8");
  return { root };
}

function writeVersions(root: string, files: Record<string, string>, active: number): void {
  const dir = path.join(root, "core", ".versions");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  fs.writeFileSync(path.join(dir, "active.txt"), String(active), "utf8");
}

function proposal(title: string, content: string, extra: Partial<SkillProposal> = {}): SkillProposal {
  return {
    id: "p1",
    kind: "core-edit",
    title,
    content,
    status: "pending",
    createdAt: "2026-09-13T00:00:00Z",
    ...extra,
  };
}

describe("evaluateCandidate (L5, детерминированная)", () => {
  it("нет данных → insufficient_data (не pass:true только из-за proposal)", () => {
    const r = evaluateCandidate("s", new SkillQualityTracker());
    assert.equal(r.pass, false);
    assert.equal(r.reason, "insufficient_data");
  });

  it("successRate >= 0.5 → pass", () => {
    const t = new SkillQualityTracker();
    t.recordOutcome("s", true, 1);
    t.recordOutcome("s", true, 2);
    assert.equal(evaluateCandidate("s", t).pass, true);
  });

  it("successRate < 0.5 → fail (не активируем «хуже»-версию)", () => {
    const t = new SkillQualityTracker();
    t.recordOutcome("s", false, 1);
    t.recordOutcome("s", false, 2);
    t.recordOutcome("s", true, 3);
    t.recordOutcome("s", false, 4);
    const r = evaluateCandidate("s", t);
    assert.equal(r.pass, false);
    assert.match(r.reason, /success_rate_below_threshold/);
  });
});

describe("getActiveSkillBody / rollbackSkill (L5 loader)", () => {
  it("loader читает активную версию (v2), а не stale SKILL.md", async () => {
    const { root } = makeRoot();
    try {
      writeVersions(root, { "v1.md": "v1 body", "v2.md": "v2 body" }, 2);
      fs.writeFileSync(path.join(root, "core", "SKILL.md"), "stale SKILL.md", "utf8");
      assert.equal(await getActiveSkillVersion("core", root), 2);
      assert.equal(await getActiveSkillBody("core", root), "v2 body");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("нет активной версии → fallback на SKILL.md", async () => {
    const { root } = makeRoot();
    try {
      assert.equal(await getActiveSkillVersion("core", root), null);
      assert.equal(await getActiveSkillBody("core", root), "# Core v1\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rollback v2→v1 → loader возвращает v1", async () => {
    const { root } = makeRoot();
    try {
      writeVersions(root, { "v1.md": "v1 body", "v2.md": "v2 body" }, 2);
      fs.writeFileSync(path.join(root, "core", "SKILL.md"), "v2 body", "utf8");
      const result = await rollbackSkill("core", 1, root);
      assert.equal(result.ok, true);
      assert.equal(await getActiveSkillVersion("core", root), 1);
      assert.equal(await getActiveSkillBody("core", root), "v1 body");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rollback к несуществующей версии → ok false", async () => {
    const { root } = makeRoot();
    try {
      const result = await rollbackSkill("core", 99, root);
      assert.equal(result.ok, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("activation gate (L5)", () => {
  it("evaluate fail → active остаётся v1 (SKILL.md не меняется)", async () => {
    const { root } = makeRoot();
    try {
      await applySkillProposal(proposal("Правило", "Делай так."), root, { env: ON });
      const failTracker = new SkillQualityTracker();
      failTracker.recordOutcome("core", false, 1);
      await assert.rejects(
        () => activateSkillProposal(proposal("Правило", "Делай так."), root, { env: ON, qualityTracker: failTracker }),
        /evaluation not passed/,
      );
      const body = await getActiveSkillBody("core", root);
      assert.ok(body && !body.includes("Делай так."), "активный контент не изменился");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("protected skill activation path blocked", async () => {
    const { root } = makeRoot();
    try {
      await applySkillProposal(proposal("Правило", "Делай так."), root, { env: ON });
      await assert.rejects(
        () =>
          activateSkillProposal(
            proposal("Правило", "Делай так.", { affectedSkillId: "delegation-triage" }),
            root,
            { env: ON },
          ),
        /protected skill/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("integration: proposal → approve(evaluate pass) → activate → loader возвращает v2", async () => {
    const { root } = makeRoot();
    try {
      await applySkillProposal(proposal("Правило", "Делай так."), root, { env: ON });
      const passTracker = new SkillQualityTracker();
      passTracker.recordOutcome("core", true, 1);
      passTracker.recordOutcome("core", true, 2);
      await activateSkillProposal(proposal("Правило", "Делай так."), root, { env: ON, qualityTracker: passTracker });
      const body = await getActiveSkillBody("core", root);
      assert.ok(body);
      assert.match(body, /Делай так\./);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
