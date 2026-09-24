import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScriptSandboxed } from "../../src/sandbox/script-executor.js";
import type { SandboxProvider } from "../../src/sandbox/types.js";

const spec = { command: "echo", args: ["hi"], timeoutMs: 1000, maxOutputChars: 1000 };

function fakeProvider(log: Array<{ backend: string }>): (backend: "dev" | "runsc") => SandboxProvider {
  return (backend) => ({
    kind: backend,
    run: async () => {
      log.push({ backend });
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  });
}

describe("runScriptSandboxed (cron script jobs)", () => {
  it("runsc available → runsc backend", async () => {
    const log: Array<{ backend: string }> = [];
    const res = await runScriptSandboxed(spec, {
      runscAvailable: () => true,
      allowLocal: false,
      providerFactory: fakeProvider(log),
    });
    assert.equal(res.exitCode, 0);
    assert.equal(log[0].backend, "runsc");
  });

  it("runsc unavailable + no local → SANDBOX_UNAVAILABLE, no spawn", async () => {
    const log: Array<{ backend: string }> = [];
    const res = await runScriptSandboxed(spec, {
      runscAvailable: () => false,
      allowLocal: false,
      providerFactory: fakeProvider(log),
    });
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /SANDBOX_UNAVAILABLE/);
    assert.equal(log.length, 0, "провайдер не вызывается (нет host-spawn)");
  });

  it("runsc unavailable + allowLocal → dev backend", async () => {
    const log: Array<{ backend: string }> = [];
    const res = await runScriptSandboxed(spec, {
      runscAvailable: () => false,
      allowLocal: true,
      providerFactory: fakeProvider(log),
    });
    assert.equal(res.exitCode, 0);
    assert.equal(log[0].backend, "dev");
  });
});
