import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emit, initObs, resetObsForTests } from "./obs.js";
import { readObsEvents, summarizeObsEvents } from "./query.js";

const tmpDirs: string[] = [];
afterEach(() => {
  resetObsForTests();
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "obs-query-"));
  tmpDirs.push(d);
  return d;
}

function writeEvents(dir: string): void {
  const saved = process.env.GRIHA_OBS;
  delete process.env.GRIHA_OBS;
  resetObsForTests();
  initObs({ dir });
  emit({ component: "telegram.gate", event: "gate.block", chatId: "-100", data: { reason: "listen_only" } });
  emit({ component: "telegram.gate", event: "gate.allow", chatId: "-100" });
  emit({ component: "report.render", event: "report.render.end", ok: false, data: { error: "boom" } });
  if (saved !== undefined) process.env.GRIHA_OBS = saved;
  resetObsForTests();
}

describe("readObsEvents / summarizeObsEvents (O5)", () => {
  it("фильтр по event", () => {
    const dir = tmpDir();
    writeEvents(dir);
    const blocks = readObsEvents({ dir, filter: { event: "gate.block" } });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].event, "gate.block");
    assert.equal(blocks[0].chatId, "-100");
  });

  it("фильтр по component", () => {
    const dir = tmpDir();
    writeEvents(dir);
    const events = readObsEvents({ dir, filter: { component: "report.render" } });
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "report.render.end");
  });

  it("summarize: total + byEvent + lastErrors", () => {
    const dir = tmpDir();
    writeEvents(dir);
    const events = readObsEvents({ dir, filter: { sinceMinutes: 60, limit: 200 } });
    const s = summarizeObsEvents(events);
    assert.equal(s.total, 3);
    assert.equal(s.byEvent["gate.block"], 1);
    assert.equal(s.byEvent["gate.allow"], 1);
    assert.equal(s.lastErrors.length, 1);
    assert.equal(s.lastErrors[0].event, "report.render.end");
  });
});
