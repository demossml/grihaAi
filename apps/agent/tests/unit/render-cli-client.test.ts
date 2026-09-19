import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRenderCliClient } from "../../src/services/render/renderCliClient.js";
import type { RenderRequest } from "@griha/render-contracts";

/** Fake child: при stdin.end() пишет resultJson в stdout и закрывается. */
class FakeChild extends EventEmitter {
  stdinWrites = "";
  constructor(
    private readonly resultJson: string,
    private readonly exitCode: number,
  ) {
    super();
  }
  stdout = {
    on: (e: string, cb: (d: Buffer) => void): void => {
      if (e === "data") this.on("_stdout", cb);
    },
  };
  stderr = {
    on: (e: string, cb: (d: Buffer) => void): void => {
      if (e === "data") this.on("_stderr", cb);
    },
  };
  stdin = {
    write: (s: string): boolean => {
      this.stdinWrites += s;
      return true;
    },
    end: (): void => {
      this.emit("_stdout", Buffer.from(this.resultJson));
      this.emit("close", this.exitCode);
    },
  };
  kill(_signal: string): void {}
}

/** Fake child, который никогда не закрывается (для timeout-теста). */
class HangingChild extends EventEmitter {
  killed = false;
  stdout = { on: (): void => {} };
  stderr = { on: (): void => {} };
  stdin = { write: (): boolean => true, end: (): void => {} };
  kill(_signal: string): void {
    this.killed = true;
  }
}

const REQUEST: RenderRequest = {
  format: "pdf",
  template: "expense-report",
  title: "Отчёт",
  locale: "ru",
  blocks: [{ kind: "markdown", text: "x" }],
  data: {},
};

test("renderCliClient ok → RenderResult ok:true + корректные args", async () => {
  let capturedArgs: string[] = [];
  let capturedStdin = "";
  const client = createRenderCliClient({
    cliPath: "/fake/bin.js",
    outDir: "/tmp/out",
    spawnImpl: (_cmd, args) => {
      capturedArgs = args;
      const child = new FakeChild(
        JSON.stringify({ ok: true, filePath: "/tmp/out/r.pdf", bytes: 100, durationMs: 1, warnings: [] }),
        0,
      );
      child.stdin.write = (s: string) => {
        capturedStdin += s;
        return true;
      };
      return child as never;
    },
  });

  const result = await client.render(REQUEST);

  assert.equal(result.ok, true);
  assert.equal(capturedArgs[0], "/fake/bin.js");
  assert.equal(capturedArgs[1], "pdf");
  assert.ok(capturedArgs.includes("--template"));
  assert.ok(capturedArgs.includes("--stdin"));
  assert.ok(capturedArgs.includes("--out"));
  const parsed = JSON.parse(capturedStdin);
  assert.equal(parsed.template, "expense-report");
  assert.equal(parsed.format, "pdf");
});

test("renderCliClient failure → RenderResult ok:false (парсит failure JSON)", async () => {
  const client = createRenderCliClient({
    cliPath: "/fake/bin.js",
    outDir: "/tmp/out",
    spawnImpl: () =>
      new FakeChild(JSON.stringify({ ok: false, code: "INVALID_INPUT", message: "bad" }), 1) as never,
  });

  const result = await client.render(REQUEST);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
});

test("renderCliClient timeout → RENDER_FAILED + SIGKILL", async () => {
  let killed = false;
  const client = createRenderCliClient({
    cliPath: "/fake/bin.js",
    outDir: "/tmp/out",
    timeoutMs: 30,
    spawnImpl: () => {
      const child = new HangingChild();
      child.kill = () => {
        killed = true;
      };
      return child as never;
    },
  });

  const result = await client.render(REQUEST);

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /timeout/);
  assert.equal(killed, true);
});
