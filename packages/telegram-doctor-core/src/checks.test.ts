import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOfflineChecks } from "./checks.js";

const VALID_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk";

function tmpHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "doctor-"));
}

test("config + валидный токен → config-present pass, token pass", async () => {
  const home = tmpHome();
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const grishDir = path.join(home, ".grish-ai");
    mkdirSync(grishDir, { recursive: true });
    writeFileSync(path.join(grishDir, "config.json"), JSON.stringify({ telegram: { botToken: VALID_TOKEN } }));

    const checks = await runOfflineChecks({ homeDir: home });
    const byId = (id: string) => checks.find((c) => c.id === id)!;

    assert.equal(byId("config-present").status, "pass");
    assert.equal(byId("telegram-token-format").status, "pass");
    // токен не выводится
    assert.ok(!checks.some((c) => c.message.includes(VALID_TOKEN)));
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("нет config → config-present fail, token fail", async () => {
  const home = tmpHome();
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const checks = await runOfflineChecks({ homeDir: home });
    const byId = (id: string) => checks.find((c) => c.id === id)!;
    assert.equal(byId("config-present").status, "fail");
    assert.equal(byId("telegram-token-format").status, "fail");
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("невалидный токен → token fail, без вывода токена", async () => {
  const home = tmpHome();
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const grishDir = path.join(home, ".grish-ai");
    mkdirSync(grishDir, { recursive: true });
    const badToken = "не-токен-123";
    writeFileSync(path.join(grishDir, "config.json"), JSON.stringify({ telegram: { botToken: badToken } }));

    const checks = await runOfflineChecks({ homeDir: home });
    const tokenCheck = checks.find((c) => c.id === "telegram-token-format")!;
    assert.equal(tokenCheck.status, "fail");
    assert.ok(!tokenCheck.message.includes(badToken));
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("render-cli-binary: есть → pass, нет → warn", async () => {
  const repo = tmpHome();
  try {
    const binDir = path.join(repo, "apps/render-cli/dist");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, "bin.js"), "#!/usr/bin/env node\n");

    const checks = await runOfflineChecks({ homeDir: tmpHome(), repoRoot: repo });
    assert.equal(checks.find((c) => c.id === "render-cli-binary")!.status, "pass");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  const repo2 = tmpHome();
  try {
    const checks = await runOfflineChecks({ homeDir: tmpHome(), repoRoot: repo2 });
    assert.equal(checks.find((c) => c.id === "render-cli-binary")!.status, "warn");
  } finally {
    rmSync(repo2, { recursive: true, force: true });
  }
});
