import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { discoverSkills, getSkillsRoot } from "@griha/skills";

const CANONICAL_SKILLS = [
  // Calendar
  "calendar-scheduling",
  "focus-time-protection",
  // Communication
  "correspondence",
  "inbox-triage",
  "commitment-tracking",
  // Meetings
  "meeting-notes",
  "meeting-prep",
  "meeting-followup",
  // Finance
  "expense-invoice-tracking",
  "transaction-categorization",
  "invoice-followup",
  "approval-thresholds",
  "financial-report",
  // Documents
  "document-intake-ocr",
  "sales-report",
  "meeting-minutes",
  "document-drafting",
  // CRM
  "client-notes-crm",
  "contact-context-briefing",
  // Travel
  "travel-coordination",
  // Proactivity
  "daily-briefing",
  "anomaly-watch",
  // System
  "privacy-data-hygiene",
  "delegation-triage",
  "voice-intake",
  "human-approval-gate",
];

describe("skill catalog", () => {
  it("contains every canonical skill plus core", async () => {
    const skills = await discoverSkills();
    const names = skills.map((s) => s.name);
    for (const expected of [...CANONICAL_SKILLS, "core"]) {
      assert.ok(names.includes(expected), `missing skill: ${expected}`);
    }
  });

  it("has no duplicate names", async () => {
    const skills = await discoverSkills();
    const names = skills.map((s) => s.name);
    assert.equal(new Set(names).size, names.length);
  });

  it("is deterministically ordered by name", async () => {
    const skills = await discoverSkills();
    const names = skills.map((s) => s.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, sorted);
  });

  it("every skill has a description", async () => {
    const skills = await discoverSkills();
    for (const s of skills) {
      assert.ok(s.description.trim().length > 0, `skill without description: ${s.name}`);
    }
  });

  it("P0-5: expenses SKILL.md содержит ключевые фразы group data/reports", () => {
    const file = path.join(getSkillsRoot(), "expenses", "SKILL.md");
    const body = fs.readFileSync(file, "utf8");
    for (const phrase of [
      "group_report",
      "group_history",
      "group_recent",
      "groups_compare",
      "Never invent archive contents",
      "sourceChatId",
      "Тихий секретарь",
    ]) {
      assert.ok(body.includes(phrase), `missing phrase in expenses SKILL.md: ${phrase}`);
    }
  });
});
