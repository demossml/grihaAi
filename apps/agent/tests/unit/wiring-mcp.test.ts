import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  HttpJsonRpcTransport,
  StdioJsonRpcTransport,
  type McpChildProcess,
  type SpawnMcpFn,
} from "../../src/runtime/mcp/transport.js";
import { McpSessionRuntime } from "../../.pi/extensions/mcp-runtime/mcp-session.js";
import type { McpServerConfig } from "@griha/shared-types";

/**
 * W9 (матрица L1, §22/K7) — MCP транспорт + сессионный runtime.
 * Flag off → неактивен (1:1 без MCP). Flag on → discovery/вызов только
 * явно названных tools, credential isolation per server, errors-as-result.
 */

// --- фейковый stdio-процесс ---

function makeFakeChild(
  respond: (msg: { id: number; method: string; params?: unknown }) => unknown,
): McpChildProcess {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  return {
    stdout: { on: (event, listener) => stdout.on(event, listener) },
    stdin: {
      write(chunk: string) {
        const msg = JSON.parse(chunk) as { id: number; method: string; params?: unknown };
        const result = respond(msg);
        if (result !== undefined) {
          setImmediate(() =>
            stdout.emit(
              "data",
              Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n"),
            ),
          );
        }
        return true;
      },
    },
    stderr: { on: (event, listener) => stderr.on(event, listener) },
    kill() {},
  };
}

const spawnFor = (respond: Parameters<typeof makeFakeChild>[0]): SpawnMcpFn =>
  () => makeFakeChild(respond);

describe("StdioJsonRpcTransport (W9)", () => {
  it("request → ответ с совпадающим id", async () => {
    const t = new StdioJsonRpcTransport({
      command: "fake",
      spawnFn: spawnFor((msg) =>
        msg.method === "tools/list" ? { tools: [{ name: "a" }] } : undefined,
      ),
    });
    const res = (await t.request("tools/list")) as { tools: Array<{ name: string }> };
    assert.equal(res.tools[0].name, "a");
    t.close();
  });

  it("ошибка сервера → reject с message", async () => {
    const t = new StdioJsonRpcTransport({
      command: "fake",
      spawnFn: () => {
        const stdout = new EventEmitter();
        return {
          stdout: { on: (event, listener) => stdout.on(event, listener) },
          stdin: {
            write(chunk: string) {
              const msg = JSON.parse(chunk) as { id: number };
              setImmediate(() =>
                stdout.emit(
                  "data",
                  Buffer.from(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: msg.id,
                      error: { code: -1, message: "server exploded" },
                    }) + "\n",
                  ),
                ),
              );
              return true;
            },
          },
          stderr: { on: () => {} },
          kill() {},
        };
      },
    });
    await assert.rejects(() => t.request("tools/call"), /server exploded/);
    t.close();
  });

  it("таймаут без ответа сервера", async () => {
    const t = new StdioJsonRpcTransport({
      command: "fake",
      timeoutMs: 20,
      spawnFn: spawnFor(() => undefined),
    });
    await assert.rejects(() => t.request("tools/list"), /timeout after 20ms/);
    t.close();
  });

  it("close() закрывает pending и kill'ит процесс", async () => {
    let killed = false;
    const t = new StdioJsonRpcTransport({
      command: "fake",
      spawnFn: () => {
        const c = makeFakeChild(() => undefined);
        const originalKill = c.kill.bind(c);
        c.kill = () => {
          killed = true;
          originalKill();
        };
        return c;
      },
    });
    const p = t.request("tools/list");
    t.close();
    await assert.rejects(p, /transport closed/);
    assert.equal(killed, true);
  });
});

describe("HttpJsonRpcTransport (W9)", () => {
  it("POST JSON-RPC и возврат result", async () => {
    const fetchFn = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { id: number; method: string };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: { ok: 1 } }),
      } as Response;
    }) as typeof fetch;
    const t = new HttpJsonRpcTransport({ url: "http://mcp.local", fetchFn });
    assert.deepEqual(await t.request("tools/call", { name: "x" }), { ok: 1 });
    t.close();
  });

  it("HTTP-ошибка → reject", async () => {
    const fetchFn = (async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const t = new HttpJsonRpcTransport({ url: "http://mcp.local", fetchFn });
    await assert.rejects(() => t.request("tools/list"), /500/);
    t.close();
  });
});

// --- сессионный runtime ---

interface FakeTransport {
  closed: boolean;
  calls: string[];
  request(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

function makeFactory(): { transports: FakeTransport[]; factory: (s: McpServerConfig) => FakeTransport } {
  const transports: FakeTransport[] = [];
  const factory = (): FakeTransport => {
    const t: FakeTransport = {
      closed: false,
      calls: [],
      request: async (method: string, params?: unknown) => {
        t.calls.push(method);
        if (method === "tools/list") {
          return { tools: [{ name: "a", description: "tool a" }, { name: "secret" }] };
        }
        if (method === "tools/call") {
          return { called: (params as { name: string }).name };
        }
        throw new Error(`unexpected ${method}`);
      },
      close() {
        this.closed = true;
      },
    };
    transports.push(t);
    return t;
  };
  return { transports, factory };
}

const servers: McpServerConfig[] = [
  { name: "files", transport: "stdio", command: "fs-server", allowedTools: ["a"] },
  { name: "web", transport: "http", url: "http://mcp.local" },
];

const ON = { HERMES_AGENT_RUNTIME: "1" };

describe("McpSessionRuntime (W9)", () => {
  it("flag off → неактивен, вызовы отклоняются", async () => {
    const { factory } = makeFactory();
    const rt = new McpSessionRuntime(servers, {}, factory);
    assert.equal(rt.active, false);
    const list = await rt.listTools("files");
    assert.equal(list.ok, false);
    assert.match(list.error ?? "", /disabled/);
    const call = await rt.callTool("files", "a");
    assert.equal(call.ok, false);
  });

  it("flag on: discovery с allowlist + явный вызов tool", async () => {
    const { factory, transports } = makeFactory();
    const rt = new McpSessionRuntime(servers, ON, factory);
    assert.equal(rt.active, true);

    const list = await rt.listTools("files");
    assert.equal(list.ok, true);
    assert.deepEqual(
      (list.tools ?? []).map((t) => t.name),
      ["a"],
    );

    const call = await rt.callTool("files", "a", { x: 1 });
    assert.equal(call.ok, true);
    assert.deepEqual(call.result, { called: "a" });

    // allowlist: "secret" не разрешён
    const blocked = await rt.callTool("files", "secret");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error ?? "", /not allowed/);
    rt.dispose();
    assert.equal(transports[0].closed, true);
  });

  it("неизвестный сервер → ошибка; transport не создаётся", async () => {
    const { factory, transports } = makeFactory();
    const rt = new McpSessionRuntime(servers, ON, factory);
    const res = await rt.callTool("nope", "a");
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /unknown mcp server/);
    assert.equal(transports.length, 0);
  });

  it("вызов до discovery → unknown tool (нет автоподстановки, §22)", async () => {
    const { factory } = makeFactory();
    const rt = new McpSessionRuntime(servers, ON, factory);
    const res = await rt.callTool("web", "ghost");
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /tool not found/);
    rt.dispose();
  });

  it("credentialScope регистрируется per server (K7)", async () => {
    const { factory } = makeFactory();
    const rt = new McpSessionRuntime(
      [{ ...servers[0], credentialScope: "fs-creds" }],
      ON,
      factory,
    );
    const list = await rt.listTools("files");
    assert.equal(list.ok, true);
    rt.dispose();
  });
});
