import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runExecuteCode } from "../../.pi/extensions/core-agent/execute-code.js";
import type { SandboxProvider, SandboxRunOptions } from "../../src/sandbox/types.js";

/**
 * I1 (§20) — execute_code за флагом.
 * Off → disabled (исполнения нет). On → безопасный код в локальном sandbox,
 * опасный (child_process/fs) → runsc обязателен; python запрещён;
 * sandbox-missing → ошибка без падения агента.
 */

const ON = { GRIHA_AGENT_RUNTIME: "1" };

function fakeProvider(
  log: Array<{ backend: string; opts: SandboxRunOptions }>,
  result: { exitCode?: number | null; stdout?: string; stderr?: string; error?: string } = {},
) {
  const factory = (backend: "dev" | "runsc"): SandboxProvider => ({
    kind: backend,
    run: async (options) => {
      log.push({ backend, opts: options });
      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "42",
        stderr: result.stderr ?? "",
        error: result.error,
      };
    },
  });
  return factory;
}

describe("runExecuteCode (I1/§20)", () => {
  it("flag off → disabled, фабрика sandbox не вызывается", async () => {
    const log: Array<{ backend: string; opts: SandboxRunOptions }> = [];
    const res = await runExecuteCode(
      { language: "javascript", code: "1+1" },
      {},
      fakeProvider(log),
    );
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /disabled/);
    assert.equal(log.length, 0);
  });

  it("python → запрещён", async () => {
    const res = await runExecuteCode(
      { language: "python", code: "print(1)" },
      ON,
      fakeProvider([]),
    );
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /python forbidden/);
  });

  it("безопасный код → локальный sandbox, compact-результат", async () => {
    const log: Array<{ backend: string; opts: SandboxRunOptions }> = [];
    const res = await runExecuteCode(
      { language: "javascript", code: "console.log(42)" },
      ON,
      fakeProvider(log),
    );
    assert.equal(res.ok, true);
    assert.equal(res.sandbox, "local");
    assert.match(res.text, /exitCode: 0/);
    assert.match(res.text, /stdout:\n42/);
    assert.equal(log.length, 1);
    assert.equal(log[0].backend, "dev");
    assert.deepEqual(log[0].opts.args, ["-e", "console.log(42)"]);
  });

  it("опасный код (child_process) → runsc обязателен", async () => {
    const log: Array<{ backend: string; opts: SandboxRunOptions }> = [];
    const res = await runExecuteCode(
      { language: "javascript", code: "require('child_process').execSync('ls')" },
      ON,
      fakeProvider(log),
    );
    assert.equal(res.ok, true);
    assert.equal(res.sandbox, "runsc");
    assert.equal(log[0].backend, "runsc");
  });

  it("sandbox missing → ошибка без падения", async () => {
    const res = await runExecuteCode(
      { language: "javascript", code: "1+1" },
      ON,
      fakeProvider([], { error: "runsc binary not found" }),
    );
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /sandbox-missing/);
  });

  it("непустой exitCode и stderr попадают в compact-результат", async () => {
    const res = await runExecuteCode(
      { language: "javascript", code: "throw new Error('boom')" },
      ON,
      fakeProvider([], { exitCode: 1, stdout: "", stderr: "boom" }),
    );
    assert.equal(res.ok, true);
    assert.match(res.text, /exitCode: 1/);
    assert.match(res.text, /stderr:\nboom/);
  });
});
