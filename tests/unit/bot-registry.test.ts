import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BotRegistry } from "../../.pi/extensions/multi-agent/BotRegistry.js";

let dir: string;
let registry: BotRegistry;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "grish-ai-bots-"));
  registry = new BotRegistry(dir);
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("BotRegistry", () => {
  it("creates a bot with an id and timestamps", async () => {
    const bot = await registry.create({
      name: "Scheduler",
      systemPrompt: "You are a scheduling assistant.",
    });
    assert.ok(bot.id);
    assert.equal(bot.name, "Scheduler");
    assert.equal(bot.systemPrompt, "You are a scheduling assistant.");
    assert.ok(bot.createdAt);
    assert.ok(bot.updatedAt);
  });

  it("lists bots and filters by project", async () => {
    await registry.create({ name: "Accountant", systemPrompt: "Finance bot", projectId: "p1" });
    await registry.create({ name: "Secretary", systemPrompt: "Office bot", projectId: "p2" });

    const all = await registry.list();
    assert.ok(all.length >= 3);

    const p1 = await registry.list("p1");
    assert.ok(p1.every((b) => b.projectId === "p1"));
    assert.ok(p1.some((b) => b.name === "Accountant"));
    assert.ok(!p1.some((b) => b.name === "Secretary"));
  });

  it("gets and deletes a bot", async () => {
    const bot = await registry.create({ name: "Temp", systemPrompt: "Temporary" });
    const fetched = await registry.get(bot.id);
    assert.equal(fetched?.name, "Temp");

    const deleted = await registry.delete(bot.id);
    assert.equal(deleted, true);
    assert.equal(await registry.get(bot.id), null);
  });
});
