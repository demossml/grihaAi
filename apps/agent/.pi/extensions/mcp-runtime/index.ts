import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "@griha/config";
import type { McpServerConfig } from "@griha/shared-types";
import {
  HttpJsonRpcTransport,
  StdioJsonRpcTransport,
  type JsonRpcTransport,
} from "../../../src/runtime/mcp/transport.js";
import { runscAvailable } from "../../../src/runtime/mcp/runsc-spawn.js";
import { McpSessionRuntime } from "./mcp-session.js";

/**
 * W9 (L1/§22) — MCP-runtime расширение.
 *
 * Транспорт (stdio/http) активируется только за флагом HERMES_AGENT_RUNTIME:
 * off = инструменты отвечают "disabled" без каких-либо действий (1:1 по
 * поведению — никаких MCP-соединений). Серверы читаются из config.json
 * (`mcp.servers`); K7 credential isolation — env каждого сервера изолирован.
 */

const transportFactory = (server: McpServerConfig): JsonRpcTransport => {
  if (server.transport === "http") {
    return new HttpJsonRpcTransport({ url: server.url ?? "" });
  }
  // runsc-апгрейд: только для stdio-серверов с sandbox: "runsc";
  // недоступный runsc → понятная ошибка (не падение агента).
  if (server.sandbox === "runsc") {
    if (!runscAvailable()) {
      throw new Error(`runsc not available for mcp server "${server.name}"`);
    }
    return new StdioJsonRpcTransport({
      command: server.command ?? "",
      args: server.args,
      env: server.env,
      sandbox: "runsc",
    });
  }
  return new StdioJsonRpcTransport({
    command: server.command ?? "",
    args: server.args,
    env: server.env,
  });
};

let runtime: McpSessionRuntime | null = null;

function getRuntime(): McpSessionRuntime | null {
  return runtime;
}

export default function mcpRuntime(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    const cfg = loadConfig();
    const servers = cfg?.mcp?.servers ?? [];
    if (servers.length === 0) {
      runtime = null;
      return;
    }
    runtime = new McpSessionRuntime(servers, process.env, transportFactory);
  });

  pi.on("session_shutdown", () => {
    runtime?.dispose();
    runtime = null;
  });

  pi.registerTool({
    name: "mcp_list_tools",
    label: "List MCP tools",
    description:
      "Список инструментов конкретного MCP-сервера (только явно запрошенный сервер).",
    parameters: Type.Object({ server: Type.String() }),
    async execute(
      _toolCallId: string,
      params: { server: string },
    ): Promise<AgentToolResult<{ ok: boolean; tools?: unknown; error?: string }>> {
      const rt = getRuntime();
      if (!rt) {
        return {
          content: [{ type: "text", text: "MCP runtime disabled (no servers or flag off)." }],
          details: { ok: false, error: "MCP runtime disabled" },
        };
      }
      const result = await rt.listTools(params.server);
      return {
        content: [
          {
            type: "text",
            text: result.ok
              ? `MCP tools on ${params.server}: ${(result.tools ?? [])
                  .map((t) => `${t.name}${t.description ? ` — ${t.description}` : ""}`)
                  .join(", ") || "(none)"}`
              : `MCP list failed: ${result.error}`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "mcp_call_tool",
    label: "Call MCP tool",
    description:
      "Вызвать конкретный инструмент MCP-сервера по имени (явный resolve — агент не получает все tools сразу).",
    parameters: Type.Object({
      server: Type.String(),
      tool: Type.String(),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    async execute(
      _toolCallId: string,
      params: { server: string; tool: string; arguments?: Record<string, unknown> },
    ): Promise<AgentToolResult<{ ok: boolean; result?: unknown; error?: string }>> {
      const rt = getRuntime();
      if (!rt) {
        return {
          content: [{ type: "text", text: "MCP runtime disabled (no servers or flag off)." }],
          details: { ok: false, error: "MCP runtime disabled" },
        };
      }
      const result = await rt.callTool(params.server, params.tool, params.arguments);
      const warningLine = result.warning ? `\n⚠️ ${result.warning}` : "";
      return {
        content: [
          {
            type: "text",
            text: result.ok
              ? `MCP ${params.server}/${params.tool}: ${JSON.stringify(result.result)}${warningLine}`
              : `MCP call failed: ${result.error}`,
          },
        ],
        details: result,
      };
    },
  });
}
