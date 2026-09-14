/**
 * L1 (post-wiring, отдельный шаг) — runsc-песочница для MCP stdio-серверов.
 * runscArgv/runscSpawn/runscAvailable; транспорт sandbox="runsc" — обёртка
 * спавна; недоступный runsc → ошибка как результат (агент не падает).
 * sandbox отсутствует/"none" = обычный spawn (1:1).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SpawnMcpFn } from "../../src/runtime/mcp/transport.js";
import { StdioJsonRpcTransport } from "../../src/runtime/mcp/transport.js";
import {
  runscArgv,
  runscAvailable,
  runscSpawn,
} from "../../src/runtime/mcp/runsc-spawn.js";
import { McpSessionRuntime } from "../../.pi/extensions/mcp-runtime/mcp-session.js";
import type { McpServerConfig } from "@griha/shared-types";

const ON: NodeJS.ProcessEnv = { HERMES_AGENT_RUNTIME: "1" };

function fakeChild() {
  return {
    stdout: { on() {} },
    stdin: { write() { return true; } },
    stderr: { on() {} },
    kill() {},
  };
}

function capturingSpawn(): { spawnFn: SpawnMcpFn; calls: Array<{ command: string; args: string[]; env: Record<string, string> }> } {
  const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = [];
  const spawnFn: SpawnMcpFn = (command, args, opts) => {
    calls.push({ command, args, env: opts.env });
    return fakeChild();
  };
  return { spawnFn, calls };
}

describe("MCP runsc-апгрейд (L1)", () => {
  it("runscArgv: префикс gVisor + команда + аргументы", () => {
    assert.deepEqual(runscArgv("node", ["srv.js", "--port", "1"]), [
      "do",
      "--rootless",
      "--network=none",
      "--",
      "node",
      "srv.js",
      "--port",
      "1",
    ]);
  });

  it("runscSpawn: спавнит runsc с переписанным argv и env сервера", () => {
    const { spawnFn, calls } = capturingSpawn();
    runscSpawn("node", ["srv.js"], { env: { TOKEN: "t" } }, "runsc", spawnFn as never);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.command, "runsc");
    assert.deepEqual(calls[0]!.args.slice(0, 5), [
      "do",
      "--rootless",
      "--network=none",
      "--",
      "node",
    ]);
    assert.equal(calls[0]!.env.TOKEN, "t");
  });

  it("runscAvailable: probe 0 → true, иначе false, исключение → false", () => {
    assert.equal(runscAvailable("runsc", () => ({ status: 0 })), true);
    assert.equal(runscAvailable("runsc", () => ({ status: 127 })), false);
    assert.equal(runscAvailable("runsc", () => ({ status: null })), false);
    assert.equal(
      runscAvailable("runsc", () => {
        throw new Error("no file");
      }),
      false,
    );
  });

  it("транспорт без sandbox → обычный spawn с исходной командой (1:1)", () => {
    const { spawnFn, calls } = capturingSpawn();
    new StdioJsonRpcTransport({ command: "node", args: ["srv.js"], spawnFn });
    assert.equal(calls[0]!.command, "node");
    assert.deepEqual(calls[0]!.args, ["srv.js"]);
  });

  it("транспорт sandbox=runsc → spawn через runsc-обёртку", () => {
    const { spawnFn, calls } = capturingSpawn();
    new StdioJsonRpcTransport({
      command: "node",
      args: ["srv.js"],
      sandbox: "runsc",
      spawnFn,
    });
    assert.equal(calls[0]!.command, "runsc");
    assert.deepEqual(calls[0]!.args.slice(0, 6), [
      "do",
      "--rootless",
      "--network=none",
      "--",
      "node",
      "srv.js",
    ]);
  });

  it("недоступный runsc: ошибка factory → listTools ok:false (агент не падает)", async () => {
    const servers: McpServerConfig[] = [
      { name: "sandboxed", transport: "stdio", command: "node", sandbox: "runsc" },
    ];
    const runtime = new McpSessionRuntime(servers, ON, () => {
      throw new Error('runsc not available for mcp server "sandboxed"');
    });
    const result = await runtime.listTools("sandboxed");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("runsc not available"));
    const call = await runtime.callTool("sandboxed", "x");
    assert.equal(call.ok, false);
    assert.ok(call.error?.includes("runsc not available"));
  });
});
