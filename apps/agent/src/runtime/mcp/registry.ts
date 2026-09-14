/**
 * Phase 12 (Item 12.1, матрица L1 + §22) — MCP registry.
 *
 * §22: server registry, discovery, tool discovery, permission policy,
 * credential isolation, execution, timeout, error handling.
 * Не давать агенту автоматически все MCP tools.
 *
 * In-memory контракт; реальный MCP-транспорт — за флагом `GRIHA_AGENT_RUNTIME`.
 */

export type McpTransport = "stdio" | "http";

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  /** Изоляция креда: скоуп, к которому привязаны credentials сервера (K7). */
  credentialScope: string;
}

export interface McpTool {
  name: string;
  description: string;
  serverId: string;
}

export interface McpExecutionPolicy {
  timeoutMs: number;
  /** Ошибки выполнения не роняют agent — возвращаются как результат. */
  propagateErrorsAsResult: boolean;
}

export const DEFAULT_MCP_EXECUTION_POLICY: McpExecutionPolicy = {
  timeoutMs: 30_000,
  propagateErrorsAsResult: true,
};

export class McpRegistry {
  private readonly servers = new Map<string, McpServer>();
  private readonly tools = new Map<string, McpTool>();

  registerServer(server: McpServer): void {
    if (this.servers.has(server.id)) {
      throw new Error(`mcp server already registered: ${server.id}`);
    }
    this.servers.set(server.id, { ...server });
  }

  /** Tool можно зарегистрировать только для существующего сервера. */
  registerTool(tool: McpTool): void {
    if (!this.servers.has(tool.serverId)) {
      throw new Error(`mcp tool references unknown server: ${tool.serverId}`);
    }
    this.tools.set(`${tool.serverId}/${tool.name}`, { ...tool });
  }

  getServer(id: string): McpServer | undefined {
    const server = this.servers.get(id);
    return server ? { ...server } : undefined;
  }

  listServers(): McpServer[] {
    return [...this.servers.values()].map((s) => ({ ...s }));
  }

  /** Discovery: инструменты сервера по явному запросу (не все сразу). */
  listTools(serverId: string): McpTool[] {
    return [...this.tools.values()]
      .filter((t) => t.serverId === serverId)
      .map((t) => ({ ...t }));
  }

  /**
   * §22: агент получает ТОЛЬКО явно запрошенные tools, а не все.
   * Неизвестное имя → ошибка (нет автоподстановки).
   */
  resolveTools(serverId: string, toolNames: readonly string[]): McpTool[] {
    const available = new Map(this.listTools(serverId).map((t) => [t.name, t]));
    const resolved: McpTool[] = [];
    for (const name of toolNames) {
      const tool = available.get(name);
      if (!tool) throw new Error(`mcp tool not found: ${serverId}/${name}`);
      resolved.push(tool);
    }
    return resolved;
  }
}
