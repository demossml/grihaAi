import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, type CliIO } from "./cli.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeDirWithEvents(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-cli-"));
  tmpDirs.push(dir);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `events-${day}.jsonl`);
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ ts: "2026-09-20T10:00:00.000Z", level: "info", component: "t", event: "hello", chatId: "-100" }),
      JSON.stringify({ ts: "2026-09-20T10:01:00.000Z", level: "info", component: "t2", event: "bye" }),
      "",
    ].join("\n"),
    "utf8",
  );
  return dir;
}

function makeIo(): { stdout: string[]; stderr: string[]; io: CliIO } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
    },
  };
}

describe("obs-cli (O2)", () => {
  it("query --event hello → 1 строка", async () => {
    const dir = makeDirWithEvents();
    const { stdout, io } = makeIo();
    const code = await run(["query", "--event", "hello", "--dir", dir], io);
    assert.equal(code, 0);
    assert.equal(stdout.length, 1);
    assert.ok(stdout[0].includes("hello"));
  });

  it("query --component t2 → 1 строка (bye)", async () => {
    const dir = makeDirWithEvents();
    const { stdout, io } = makeIo();
    await run(["query", "--component", "t2", "--dir", dir], io);
    assert.equal(stdout.length, 1);
    assert.ok(stdout[0].includes("bye"));
  });

  it("tail --lines 1 → последняя строка", async () => {
    const dir = makeDirWithEvents();
    const { stdout, io } = makeIo();
    await run(["tail", "--lines", "1", "--dir", dir], io);
    assert.equal(stdout.length, 1);
    assert.ok(stdout[0].includes("bye"));
  });

  it("path печатает каталог", async () => {
    const { stdout, io } = makeIo();
    const code = await run(["path"], io);
    assert.equal(code, 0);
    assert.ok(stdout[0].length > 0);
  });

  it("--help → usage, code 0", async () => {
    const { stdout, io } = makeIo();
    const code = await run(["--help"], io);
    assert.equal(code, 0);
    assert.ok(stdout[0].includes("Usage"));
  });
});
