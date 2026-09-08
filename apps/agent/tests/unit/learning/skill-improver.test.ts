import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SkillProposalStore,
  applySkillProposal,
  isProtectedSkillContent,
  parseSkillProposal,
  proposeSkillImprovement,
} from "../../../src/utils/learning/skill-improver.js";

describe("parseSkillProposal", () => {
  it("parses a core-edit proposal", () => {
    const p = parseSkillProposal(
      'text before {"kind":"core-edit","title":"Новая процедура","content":"### Шаги\\n1. ..."}',
      "2026-09-08T00:00:00.000Z",
    );
    assert.ok(p);
    assert.equal(p.kind, "core-edit");
    assert.equal(p.title, "Новая процедура");
    assert.equal(p.status, "pending");
  });

  it("parses a new-skill proposal", () => {
    const p = parseSkillProposal(
      '{"kind":"new-skill","name":"Отчёты","description":"Генерация отчётов","title":"Отчёты","content":"Тело"}',
    );
    assert.ok(p);
    assert.equal(p.kind, "new-skill");
    assert.equal(p.name, "Отчёты");
    assert.equal(p.description, "Генерация отчётов");
  });

  it("returns null for kind none or malformed output", () => {
    assert.equal(parseSkillProposal('{"kind":"none"}'), null);
    assert.equal(parseSkillProposal("not json"), null);
    assert.equal(parseSkillProposal('{"kind":"core-edit","title":"x"}'), null); // no content
  });

  it("rejects proposals touching protected domains (learning guard)", () => {
    // Security/approval/financial-policy content must never be auto-proposed.
    assert.equal(
      parseSkillProposal('{"kind":"core-edit","title":"T","content":"поднять financial limit"}'),
      null,
    );
    assert.equal(
      parseSkillProposal('{"kind":"new-skill","name":"human-approval-gate","title":"T","content":"body"}'),
      null,
    );
    assert.equal(isProtectedSkillContent("изменить approval policy"), true);
    assert.equal(isProtectedSkillContent("добавить процедуру еженедельного отчёта"), false);
  });
});

describe("proposeSkillImprovement", () => {
  it("calls the llm and returns a pending proposal", async () => {
    const llm = async () => '{"kind":"core-edit","title":"T","content":"body"}';
    const p = await proposeSkillImprovement(["note1", "note2"], llm);
    assert.ok(p);
    assert.equal(p.title, "T");
    assert.equal(p.status, "pending");
  });
});

describe("SkillProposalStore", () => {
  it("saves, lists and updates proposal status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proposals-"));
    try {
      const store = new SkillProposalStore(dir);
      const p = parseSkillProposal('{"kind":"core-edit","title":"T","content":"body"}')!;
      await store.save(p);
      assert.equal((await store.list()).length, 1);

      const updated = await store.updateStatus(p.id, "applied");
      assert.equal(updated?.status, "applied");
      assert.ok(updated?.appliedAt);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applySkillProposal", () => {
  it("appends a core-edit to core/SKILL.md", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
    const coreDir = path.join(root, "core");
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, "SKILL.md"), "---\nname: core\n---\n# Core\n", "utf8");

    try {
      const proposal = parseSkillProposal(
        '{"kind":"core-edit","title":"Новое правило","content":"Делай так."}',
      )!;
      const target = await applySkillProposal(proposal, root);
      assert.equal(target, path.join(root, "core", "SKILL.md"));
      const content = fs.readFileSync(target, "utf8");
      assert.match(content, /Новое правило/);
      assert.match(content, /Делай так\./);
      assert.match(content, /^---\nname: core/); // frontmatter preserved
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a new skill with autoCreated frontmatter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
    try {
      const proposal = parseSkillProposal(
        '{"kind":"new-skill","name":"отчёты","description":"Генерация отчётов","title":"Отчёты","content":"Тело навыка"}',
      )!;
      const target = await applySkillProposal(proposal, root);
      assert.equal(target, path.join(root, "отчёты", "SKILL.md"));
      const content = fs.readFileSync(target, "utf8");
      assert.match(content, /^---\nname: отчёты\n/);
      assert.match(content, /autoCreated: true/);
      assert.match(content, /Тело навыка/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
