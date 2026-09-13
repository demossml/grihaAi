import type { McpServerConfig } from "@griha/shared-types";
import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import { McpRegistry } from "../../../src/runtime/mcp/registry.js";
import {
  discoverMcpTools,
  invokeMcpTool,
  type JsonRpcTransport,
  type McpToolCallResult,
} from "../../../src/runtime/mcp/transport.js";

/**
 * W9 (L1) — сессионный MCP-runtime поверх McpRegistry + транспорта.
 *
 * §22: агент не получает все tools сразу — только через явный resolve
 * (`mcp_call_tool` называет конкретный tool). K7: каждый сервер имеет
 * собственный credentialScope и transport (env не смешиваются).
 * Активация только за флагом HERMES_AGENT_RUNTIME.
 */

export type McpTransportFactory = (server: McpServerConfig) => JsonRpcTransport;

export interface McpToolListResult {
  ok: boolean;
  tools?: Array<{ name: string; description?: string }>;
  error?: string;
}

export class McpSessionRuntime {
  private readonly registry = new McpRegistry();
  private readonly transports = new Map<string, JsonRpcTransport>();
  private readonly configByName = new Map<string, McpServerConfig>();

  constructor(
    private readonly servers: McpServerConfig[],
    private readonly env: NodeJS.ProcessEnv,
    private readonly factory: McpTransportFactory,
  ) {
    for (const server of servers) {
      this.configByName.set(server.name, server);
      this.registry.registerServer({
        id: server.name,
        name: server.name,
        transport: server.transport,
        credentialScope: server.credentialScope ?? server.name,
      });
    }
  }

  /** Флаг включён и есть хотя бы один сервер. */
  get active(): boolean {
    return isAgentRuntimeEnabled(this.env) && this.servers.length > 0;
  }

  private transportFor(name: string): JsonRpcTransport | null {
    if (!this.registry.getServer(name)) return null;
    let transport = this.transports.get(name);
    if (!transport) {
      const cfg = this.configByName.get(name);
      if (!cfg) return null;
      transport = this.factory(cfg);
      this.transports.set(name, transport);
    }
    return transport;
  }

  private isAllowed(serverName: string, toolName: string): boolean {
    const cfg = this.configByName.get(serverName);
    if (!cfg?.allowedTools || cfg.allowedTools.length === 0) return true;
    return cfg.allowedTools.includes(toolName);
  }

  /** Discovery одного сервера; регистрирует tools в registry. */
  async listTools(serverName: string): Promise<McpToolListResult> {
    if (!this.active) {
      return { ok: false, error: "MCP runtime disabled (HERMES_AGENT_RUNTIME off)" };
    }
    const transport = this.transportFor(serverName);
    if (!transport) return { ok: false, error: `unknown mcp server: ${serverName}` };
    try {
      const discovered = await discoverMcpTools(transport);
      const tools = discovered.filter((t) => this.isAllowed(serverName, t.name));
      for (const tool of tools) {
        this.registry.registerTool({
          name: tool.name,
          description: tool.description ?? "",
          serverId: serverName,
        });
      }
      return { ok: true, tools };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Вызов конкретного tool: явный resolve (не все сразу), таймаут, errors-as-result. */
  async callTool(
    serverName: string,
    toolName: string,
    args?: unknown,
  ): Promise<McpToolCallResult> {
    if (!this.active) {
      return { ok: false, error: "MCP runtime disabled (HERMES_AGENT_RUNTIME off)" };
    }
    const transport = this.transportFor(serverName);
    if (!transport) return { ok: false, error: `unknown mcp server: ${serverName}` };
    if (!this.isAllowed(serverName, toolName)) {
      return { ok: false, error: `tool not allowed on server ${serverName}: ${toolName}` };
    }
    try {
      // §22: неизвестное имя tool → ошибка (нет автоподстановки).
      this.registry.resolveTools(serverName, [toolName]);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return invokeMcpTool(transport, toolName, args);
  }

  dispose(): void {
    for (const transport of this.transports.values()) transport.close();
    this.transports.clear();
  }
}
