import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProfileSection } from "../../.pi/extensions/core-agent/profile-section.js";

/**
 * W12 (матрица O1, §29) — выбор профиля бота за флагом.
 * Flag off → пустая секция (1:1). Flag on → persona-секция профиля;
 * неизвестный профиль молча игнорируется (не ломает запуск).
 */

const ON = { HERMES_AGENT_RUNTIME: "1" };
const OFF = {};

describe("buildProfileSection (W12/O1)", () => {
  it("flag off → пустая секция", () => {
    assert.equal(buildProfileSection(OFF, "secretary").section, "");
  });

  it("flag on, без имени профиля → пустая секция", () => {
    assert.equal(buildProfileSection(ON).section, "");
    assert.equal(buildProfileSection(ON, "  ").section, "");
  });

  it("flag on + известный id → persona-секция с toolsets и role", () => {
    const res = buildProfileSection(ON, "secretary");
    assert.ok(res.section.includes("## Agent profile: Secretary"));
    assert.ok(res.section.includes("встречи"));
    assert.ok(res.section.includes("Toolsets: core, memory, cron, telegram"));
    assert.equal(res.profileId, "secretary");
  });

  it("flag on + имя профиля (case-insensitive) → та же секция", () => {
    const res = buildProfileSection(ON, "Accountant");
    assert.ok(res.section.includes("## Agent profile: Accountant"));
    assert.ok(res.section.includes("Memory policy:"));
    assert.equal(res.profileId, "accountant");
  });

  it("flag on + неизвестный профиль → пустая секция (без падения)", () => {
    const res = buildProfileSection(ON, "no-such-profile");
    assert.equal(res.section, "");
    assert.equal(res.profileId, undefined);
  });
});
