import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emit,
  initObs,
  resetObsForTests,
} from "./obs.js";
import { redactString } from "./redact.js";

const tmpDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(key: string): void {
  savedEnv[key] = process.env[key];
}

afterEach(() => {
  resetObsForTests();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-"));
  tmpDirs.push(dir);
  return dir;
}

function listEventFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"));
}

describe("observability core (O1)", () => {
  it("GRIHA_OBS=0 → emit не создаёт файл", () => {
    saveEnv("GRIHA_OBS");
    saveEnv("GRIHA_OBS_DIR");
    process.env.GRIHA_OBS = "0";
    const dir = tmpDir();
    process.env.GRIHA_OBS_DIR = dir;
    resetObsForTests();
    emit({ component: "t", event: "hello" });
    assert.equal(listEventFiles(dir).length, 0, "no-op при GRIHA_OBS=0");
  });

  it("emit пишет JSONL, токен redact-нут", () => {
    saveEnv("GRIHA_OBS");
    delete process.env.GRIHA_OBS;
    const dir = tmpDir();
    resetObsForTests();
    initObs({ dir });
    const token = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
    emit({
      component: "t",
      event: "hello",
      data: { token, note: "ok", nested: { authorization: "Bearer abc123" } },
    });
    const files = listEventFiles(dir);
    assert.equal(files.length, 1);
    const raw = fs.readFileSync(path.join(dir, files[0]), "utf8");
    assert.ok(raw.includes("hello"), "событие записано");
    assert.ok(!raw.includes(token), "токен не попал в лог");
    assert.ok(raw.includes("[REDACTED]"), "токен redact-нут");
    assert.ok(!raw.includes("Bearer abc123"), "bearer redact-нут");
  });

  it("emit не бросает, если sink.write падает", () => {
    saveEnv("GRIHA_OBS");
    delete process.env.GRIHA_OBS;
    resetObsForTests();
    initObs({
      sink: {
        write() {
          throw new Error("disk full");
        },
      },
    });
    // не должен бросить
    emit({ component: "t", event: "hello" });
    assert.ok(true, "emit не бросил");
  });

  it("redactString обрезает длинные строки и redact-ит token-like", () => {
    const out = redactString("1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    assert.ok(out.includes("[REDACTED_TOKEN]"));
    const long = redactString("x".repeat(1000));
    assert.ok(long.length <= 501, "обрезано до 500 + …");
    assert.ok(long.endsWith("…"));
  });
});
