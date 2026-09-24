import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandboxEnv, isSensitiveEnvKey, scrubEnv } from "../../src/sandbox/env-scrub.js";
import { createSandboxProvider } from "../../src/sandbox/index.js";

test("scrubEnv: keep allowlist, strip secrets", () => {
  const out = scrubEnv({
    PATH: "/usr/bin",
    HOME: "/home/u",
    NODE_ENV: "production",
    TELEGRAM_BOT_TOKEN: "123:secret",
    DEEPSEEK_API_KEY: "sk-abc",
    DB_PASSWORD: "hunter2",
    FOO: "bar",
  });
  assert.equal(out.PATH, "/usr/bin");
  assert.equal(out.HOME, "/home/u");
  assert.equal(out.NODE_ENV, "production");
  assert.equal(out.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(out.DEEPSEEK_API_KEY, undefined);
  assert.equal(out.DB_PASSWORD, undefined);
  assert.equal(out.FOO, undefined);
});

test("isSensitiveEnvKey: token/key/secret/password → true; PATH → false", () => {
  assert.equal(isSensitiveEnvKey("TELEGRAM_BOT_TOKEN"), true);
  assert.equal(isSensitiveEnvKey("DEEPSEEK_API_KEY"), true);
  assert.equal(isSensitiveEnvKey("DB_PASSWORD"), true);
  assert.equal(isSensitiveEnvKey("AWS_SECRET_ACCESS_KEY"), true);
  assert.equal(isSensitiveEnvKey("PATH"), false);
  assert.equal(isSensitiveEnvKey("NODE_ENV"), false);
});

test("buildSandboxEnv: allowlist + extra, но секретные extra-ключи отбрасываются", () => {
  const out = buildSandboxEnv({
    MY_FLAG: "1",
    TELEGRAM_BOT_TOKEN: "leak",
    CUSTOM_API_KEY: "leak2",
  });
  assert.equal(out.MY_FLAG, "1");
  assert.equal(out.TELEGRAM_BOT_TOKEN, undefined, "secret extra не пропускается");
  assert.equal(out.CUSTOM_API_KEY, undefined, "api key extra не пропускается");
  assert.ok(out.PATH, "allowlist PATH присутствует");
});

test("P0: sandbox spawn не наследует host-секреты", async () => {
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "TEST_SECRET_123";
  try {
    const sb = createSandboxProvider("dev");
    const res = await sb.run({
      command: "node",
      args: ["-e", "console.log(process.env.TELEGRAM_BOT_TOKEN || 'NONE')"],
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout.trim(), "NONE", "секрет не должен попасть в sandbox-процесс");
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  }
});

test("P0: sandbox видит allowlist (PATH/TZ), но не видит произвольный secret", async () => {
  const prev = process.env.MY_SECRET_KEY;
  process.env.MY_SECRET_KEY = "leak-me";
  try {
    const sb = createSandboxProvider("dev");
    const res = await sb.run({
      command: "node",
      args: [
        "-e",
        "console.log(JSON.stringify({ path: !!process.env.PATH, secret: process.env.MY_SECRET_KEY || 'NONE' }))",
      ],
    });
    assert.equal(res.exitCode, 0);
    const parsed = JSON.parse(res.stdout.trim());
    assert.equal(parsed.path, true, "PATH (allowlist) присутствует");
    assert.equal(parsed.secret, "NONE", "MY_SECRET_KEY не передаётся");
  } finally {
    if (prev === undefined) delete process.env.MY_SECRET_KEY;
    else process.env.MY_SECRET_KEY = prev;
  }
});
