import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSandboxProvider } from "../../src/sandbox/index.js";
import { LocalSandboxProvider } from "../../src/sandbox/local-sandbox.js";

describe("sandbox providers", () => {
  it("dev backend runs a command and captures stdout", async () => {
    const sb = createSandboxProvider("dev");
    assert.equal(sb.kind, "dev");
    const res = await sb.run({ command: "node", args: ["-e", "console.log('hello')"] });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout.trim(), "hello");
    assert.equal(res.error, undefined);
  });

  it("dev backend forwards stdin and captures stderr", async () => {
    const sb = new LocalSandboxProvider();
    const res = await sb.run({
      command: "node",
      args: ["-e", "process.stdin.on('data', d => { console.error('echo:' + d.toString().trim()) })"],
      input: "abc",
    });
    assert.equal(res.exitCode, 0);
    assert.match(res.stderr, /echo:abc/);
  });

  it("dev backend times out a hanging command", async () => {
    const sb = new LocalSandboxProvider();
    const res = await sb.run({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"],
      timeoutMs: 200,
    });
    assert.equal(res.timedOut, true);
  });

  it("runsc backend reports an error when the runtime is missing", async () => {
    const sb = createSandboxProvider("runsc", { runscPath: "/nonexistent/runsc" });
    assert.equal(sb.kind, "runsc");
    const res = await sb.run({ command: "echo", args: ["hi"] });
    assert.equal(res.exitCode, null);
    assert.ok(res.error);
  });
});
