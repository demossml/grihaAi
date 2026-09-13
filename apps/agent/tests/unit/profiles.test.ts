/**
 * Item 15.1 (O1/§29): профили ботов.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROFILES,
  ProfileRegistry,
  createDefaultProfileRegistry,
} from "../../src/runtime/profiles/profile.js";

describe("Profiles (Item 15.1)", () => {
  it("дефолтные профили §29: accountant/developer/secretary/researcher/travel", () => {
    const ids = DEFAULT_PROFILES.map((p) => p.id);
    assert.deepEqual(ids, ["accountant", "developer", "secretary", "researcher", "travel"]);
  });

  it("registry: register/get/list/remove", () => {
    const registry = new ProfileRegistry();
    registry.register(DEFAULT_PROFILES[0]);
    assert.equal(registry.get("accountant")?.name, "Accountant");
    assert.equal(registry.list().length, 1);
    assert.equal(registry.remove("accountant"), true);
    assert.equal(registry.get("accountant"), undefined);
  });

  it("дубликат профиля → ошибка", () => {
    const registry = createDefaultProfileRegistry();
    assert.throws(() => registry.register(DEFAULT_PROFILES[0]), /already registered/);
  });

  it("resolveByName: единый Agent Runtime, выбор по имени", () => {
    const registry = createDefaultProfileRegistry();
    assert.equal(registry.resolveByName("developer")?.id, "developer");
    assert.equal(registry.resolveByName("DEVELOPER")?.id, "developer");
    assert.equal(registry.resolveByName("nope"), undefined);
  });

  it("secretary: ограниченная automationPolicy", () => {
    const secretary = createDefaultProfileRegistry().get("secretary");
    assert.deepEqual(secretary?.automationPolicy?.allowedKinds, ["one-shot", "recurring"]);
  });
});
