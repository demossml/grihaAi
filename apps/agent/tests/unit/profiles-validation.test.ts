/**
 * Item 15.2 (O1): валидация профилей.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateProfile,
  validateProfiles,
} from "../../src/runtime/profiles/validation.js";
import { DEFAULT_PROFILES } from "../../src/runtime/profiles/profile.js";

describe("Profile validation (Item 15.2)", () => {
  it("дефолтные профили валидны", () => {
    const result = validateProfiles(DEFAULT_PROFILES);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("пустая persona → ошибка", () => {
    const result = validateProfile({ ...DEFAULT_PROFILES[0], persona: "  " });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /persona/);
  });

  it("невалидный toolset → ошибка", () => {
    const result = validateProfile({
      ...DEFAULT_PROFILES[0],
      toolsets: ["nope" as never],
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /toolset невалиден/);
  });

  it("невалидная modelRole → ошибка", () => {
    const result = validateProfile({
      ...DEFAULT_PROFILES[0],
      modelRole: "bogus" as never,
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /modelRole/);
  });

  it("дубликаты id в списке → ошибка", () => {
    const result = validateProfiles([DEFAULT_PROFILES[0], { ...DEFAULT_PROFILES[0] }]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /дубликат id/);
  });
});
