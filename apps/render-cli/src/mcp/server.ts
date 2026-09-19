import { createInterface } from "node:readline";
import { renderDocument, listTemplates } from "@griha/render-tools";
import type { RenderResult } from "@griha/render-contracts";

/**
 * MCP stdio-сервер для griha-render: line-delimited JSON-RPC по stdin/stdout.
 * methods: initialize, tools/list, tools/call.
 * tools: list_templates, render_pdf, render_pptx.
 */

export interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const SERVER_INFO = { name: "griha-render", version: "0.1.0" };

const TOOLS = [
  { name: "list_templates", description: "Список доступных шаблонов отчётов" },
  { name: "render_pdf", description: "Сгенерировать PDF-отчёт (RenderRequest + outDir)" },
  { name: "render_pptx", description: "Сгенерировать PPTX (пока не реализован)" },
];

/** Обработка одного JSON-RPC запроса (чистая, тестируемая). */
export async function dispatchRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id;

  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

    case "tools/call": {
      const params = (req.params ?? {}) as { name?: string; arguments?: unknown };
      const name = params.name;
      if (!name) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: "missing tool name" } };
      }
      if (name === "list_templates") {
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(listTemplates()) }] },
        };
      }
      if (name === "render_pdf" || name === "render_pptx") {
        const args = (params.arguments ?? {}) as { request?: unknown; outDir?: string };
        if (!args.outDir) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "outDir is required" } };
        }
        const format = name === "render_pdf" ? "pdf" : "pptx";
        const request = { ...(args.request as Record<string, unknown>), format };
        const result: RenderResult = await renderDocument(request, { outDir: args.outDir });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result) }],
            isError: !result.ok,
          },
        };
      }
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown tool: ${name}` } };
    }

    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${req.method}` } };
  }
}

/** Читает JSON-RPC построчно из stdin, пишет ответы в stdout. */
export async function runMcpServer(io: { stdout: (s: string) => void }): Promise<number> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      io.stdout(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
      continue;
    }
    try {
      const resp = await dispatchRequest(req);
      io.stdout(JSON.stringify(resp));
    } catch (err) {
      io.stdout(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
        }),
      );
    }
  }
  return 0;
}
