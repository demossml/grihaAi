import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GrishAiConfig } from "@griha/shared-types";
import {
  configExists,
  getConfigPath,
  loadConfig,
  saveConfig,
} from "@griha/config";

let tempHome: string;

before(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "grish-ai-config-"));
  process.env.GRISH_AI_HOME = tempHome;
});

after(() => {
  delete process.env.GRISH_AI_HOME;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<GrishAiConfig> = {}): GrishAiConfig {
  return {
    version: 1,
    provider: "deepseek",
    model: "deepseek-chat",
    setupCompletedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("config storage", () => {
  beforeEach(() => {
    const p = getConfigPath();
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  });

  it("configExists() returns false when file missing", () => {
    assert.equal(configExists(), false);
  });

  it("saveConfig + loadConfig round-trip", () => {
    const cfg = makeConfig({ apiKey: "sk-test", baseUrl: "https://api.deepseek.com" });
    saveConfig(cfg);
    assert.equal(configExists(), true);
    assert.deepEqual(loadConfig(), cfg);
  });

  it("writes config to the expected path", () => {
    const cfg = makeConfig();
    saveConfig(cfg);

    const expected = path.join(tempHome, ".grish-ai", "config.json");
    assert.equal(getConfigPath(), expected);
    assert.equal(fs.existsSync(expected), true);

    const raw = JSON.parse(fs.readFileSync(expected, "utf8")) as GrishAiConfig;
    assert.equal(raw.provider, "deepseek");
    assert.equal(raw.model, "deepseek-chat");
    assert.equal(raw.version, 1);
  });

  it("loadConfig returns null for invalid JSON", () => {
    const dir = path.join(tempHome, ".grish-ai");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(), "{ not json", "utf8");
    assert.equal(loadConfig(), null);
  });
});
