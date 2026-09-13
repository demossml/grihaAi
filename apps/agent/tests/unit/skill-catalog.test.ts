import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { discoverSkills } from "@griha/skills";

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

  it("core skill includes tool-use enforcement (H4)", async () => {
    const skills = await discoverSkills();
    const core = skills.find((s) => s.name === "core");
    assert.ok(core, "core skill must exist");
    const content = fs.readFileSync(core.path, "utf8");
    assert.match(content, /Tool-use enforcement|вызови инструмент|call the tool/i);
  });
});
