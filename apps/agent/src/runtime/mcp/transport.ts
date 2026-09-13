import { spawn } from "node:child_process";
import {
  DEFAULT_MCP_EXECUTION_POLICY,
  type McpExecutionPolicy,
} from "./registry.js";

/**
 * W9 (матрица L1, §22) — MCP транспорт: stdio и http JSON-RPC.
 *
 * K7 credential isolation: env передаётся ТОЛЬКО своему серверу (per-server
 * spawn/env), credentials никогда не смешиваются между серверами. Ошибки
 * выполнения не роняют агента — возвращаются как результат (политика).
 */

export interface JsonRpcTransport {
  request(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** stdio: процесс сервера, line-delimited JSON-RPC по stdin/stdout. */
export interface McpChildProcess {
  stdout: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  };
  stdin: { write(chunk: string): boolean };
  stderr: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  };
  kill(): void;
}

export type SpawnMcpFn = (
  command: string,
  args: string[],
  opts: { env: Record<string, string> },
) => McpChildProcess;

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  /** K7: env только этого сервера. */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Инъекция для тестов. Default: child_process.spawn. */
  spawnFn?: SpawnMcpFn;
}

export class StdioJsonRpcTransport implements JsonRpcTransport {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private buffer = "";
  private closed = false;

  constructor(private readonly options: StdioTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MCP_EXECUTION_POLICY.timeoutMs;
    this.child = (options.spawnFn ?? defaultSpawn)(options.command, options.args ?? [], {
      env: options.env ?? {},
    });
    this.child.stdout.on("data", (chunk) => this.onData(chunk.toString("utf8")));
  }

  private readonly child: McpChildProcess;
  private readonly timeoutMs: number;

  private onData(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        const entry = this.pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          if (msg.error) entry.reject(new Error(msg.error.message));
          else entry.resolve(msg.result);
        }
      } catch {
        // не-JSON строка (лог сервера) — игнорируем
      }
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("mcp transport closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp request timeout after ${this.timeoutMs}ms: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload + "\n");
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("mcp transport closed"));
    }
    this.pending.clear();
    this.child.kill();
  }
}

function defaultSpawn(
  command: string,
  args: string[],
  opts: { env: Record<string, string> },
): McpChildProcess {
  return spawn(command, args, { env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
}

export interface HttpTransportOptions {
  url: string;
  /** K7: заголовки (напр. bearer-кред) только этого сервера. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Инъекция для тестов. Default: globalThis.fetch. */
  fetchFn?: typeof fetch;
}

export class HttpJsonRpcTransport implements JsonRpcTransport {
  private nextId = 1;
  private closed = false;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MCP_EXECUTION_POLICY.timeoutMs;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) throw new Error("mcp transport closed");
    const fetchFn = this.options.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetchFn(this.options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.options.headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method,
          params,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`mcp http ${res.status}: ${res.statusText}`);
      }
      const msg = (await res.json()) as JsonRpcResponse;
      if (msg.error) throw new Error(msg.error.message);
      return msg.result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`mcp request timeout after ${this.timeoutMs}ms: ${method}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.closed = true;
  }
}

export interface McpToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** K4: предупреждение injection-scan (не влияет на ok). */
  warning?: string;
}

/** Discovery: tools/list. Пустой/битый ответ → пустой список (не роняет). */
export async function discoverMcpTools(
  transport: JsonRpcTransport,
): Promise<McpToolDescriptor[]> {
  const result = await transport.request("tools/list");
  if (result && typeof result === "object" && Array.isArray((result as { tools?: unknown[] }).tools)) {
    const tools = (result as { tools: Array<{ name: string; description?: string }> }).tools;
    return tools.map((t) => ({ name: t.name, description: t.description }));
  }
  return [];
}

/** tools/call с политикой (errors-as-result, таймаут). */
export async function invokeMcpTool(
  transport: JsonRpcTransport,
  toolName: string,
  args: unknown,
  policy: McpExecutionPolicy = DEFAULT_MCP_EXECUTION_POLICY,
): Promise<McpToolCallResult> {
  try {
    const result = await transport.request("tools/call", {
      name: toolName,
      arguments: args ?? {},
    });
    return { ok: true, result };
  } catch (error) {
    if (policy.propagateErrorsAsResult) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    throw error;
  }
}
