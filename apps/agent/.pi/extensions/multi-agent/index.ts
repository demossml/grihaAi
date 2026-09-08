import path from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BotRegistry } from "./BotRegistry.js";
import { SubAgentManager, type SubAgentRunner, type SubAgentResult } from "./SubAgentManager.js";
import { SqliteRagMemoryService } from "../sqlite-rag-memory/MemoryService.js";
import { HashingEmbeddingService } from "../../../src/utils/embeddings.js";
import type { SearchResult, SubAgentState, SubAgentTask } from "../../../src/types/index.js";

const BOTS_DIR = path.join(process.cwd(), ".grish-ai", "bots");
const MEMORY_DB_PATH = path.join(homedir(), ".grish-ai", "memory.sqlite");

let registry: BotRegistry | null = null;

function getRegistry(): BotRegistry {
  if (!registry) registry = new BotRegistry(BOTS_DIR);
  return registry;
}

let memory: SqliteRagMemoryService | null = null;
let manager: SubAgentManager | null = null;

async function getMemory(): Promise<SqliteRagMemoryService> {
  if (!memory) {
    memory = new SqliteRagMemoryService(new HashingEmbeddingService());
    await memory.init(MEMORY_DB_PATH);
  }
  return memory;
}

/**
 * Emulated runner: sub-agent tasks execute deterministically in this phase.
 * Swap for a real LLM runner with an isolated context scoped by
 * `subtreeSessionId` when available.
 */
const emulatedRunner: SubAgentRunner = async (task) => ({
  result: `Подзадача выполнена (роль: ${task.role ?? "general"}): ${task.goal}`,
});

function getManager(): SubAgentManager {
  if (!manager) {
    manager = new SubAgentManager(
      { addInsight: (i) => getMemory().then((m) => m.addInsight(i)) },
      emulatedRunner,
    );
  }
  return manager;
}

export default function multiAgent(pi: ExtensionAPI): void {
  pi.registerCommand("/bots", {
    description: "List named specialist bots",
    async handler() {
      const bots = await getRegistry().list();
      const text =
        bots.length === 0
          ? "No bots registered."
          : bots
              .map((b) => `- ${b.name}${b.projectId ? ` (project: ${b.projectId})` : ""}: ${b.systemPrompt}`)
              .join("\n");
      pi.sendMessage({
        customType: "bots-list",
        content: text,
        display: true,
        details: bots,
      });
    },
  });

  pi.registerCommand("/bots-create", {
    description: "Create a new named specialist bot",
    async handler(args) {
      const trimmed = args.trim();
      const space = trimmed.search(/\s/);
      if (space === -1) {
        pi.sendMessage({
          customType: "bots-create-error",
          content: "Usage: /bots-create <name> <system prompt...>",
          display: true,
        });
        return;
      }

      const name = trimmed.slice(0, space).trim();
      const systemPrompt = trimmed.slice(space + 1).trim();
      if (!name || !systemPrompt) {
        pi.sendMessage({
          customType: "bots-create-error",
          content: "Name and system prompt are required.",
          display: true,
        });
        return;
      }

      const bot = await getRegistry().create({ name, systemPrompt });
      pi.sendMessage({
        customType: "bots-create",
        content: `Created bot "${bot.name}" (${bot.id})`,
        display: true,
        details: bot,
      });
    },
  });

  pi.registerTool({
    name: "delegate_tasks",
    label: "Delegate tasks",
    description: "Разбить сложную задачу и запустить несколько субагентов. Использовать когда задача COMPLEX.",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          goal: Type.String(),
          context: Type.Optional(Type.String()),
          role: Type.Optional(Type.String()),
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { tasks: Array<{ goal: string; context?: string; role?: string }> },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ results: SubAgentResult[] }>> {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const results = await getManager().delegate(
        params.tasks.map((t) => ({ ...t, parentSessionId })),
      );
      const text =
        results.length === 0
          ? "No tasks delegated."
          : results.map((r) => `- ${r.result}`).join("\n");
      return { content: [{ type: "text", text }], details: { results } };
    },
  });

  pi.registerTool({
    name: "check_subagents",
    label: "Check sub-agents",
    description: "Показать статус запущенных субагентов.",
    parameters: Type.Object({}),
    async execute(): Promise<AgentToolResult<{ tasks: SubAgentTask[] }>> {
      const tasks = getManager().listTasks();
      const text =
        tasks.length === 0
          ? "No sub-agents."
          : tasks.map((t) => `- ${t.status}: ${t.goal} (${t.id})`).join("\n");
      return { content: [{ type: "text", text }], details: { tasks } };
    },
  });

  pi.registerTool({
    name: "get_shared_insights",
    label: "Get shared insights",
    description: "Поиск по Shared Insights.",
    parameters: Type.Object({
      query: Type.String(),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(
      _toolCallId: string,
      params: { query: string; limit?: number },
    ): Promise<AgentToolResult<{ results: SearchResult[] }>> {
      const results = await (await getMemory()).searchInsights(params.query, {
        limit: params.limit,
      });
      const text =
        results.length === 0
          ? "No matching insights."
          : results.map((r) => `- ${r.content}`).join("\n");
      return { content: [{ type: "text", text }], details: { results } };
    },
  });

  pi.registerCommand("status", {
    description: "Show active sub-agents",
    async handler() {
      const states = getManager().listRunning();
      const text =
        states.length === 0
          ? "No active sub-agents."
          : states.map((s) => `- ${s.status}: ${s.goal} (${s.taskId}) [${s.lastUpdateAt}]`).join("\n");
      pi.sendMessage({
        customType: "delegation-status",
        content: [{ type: "text", text }],
        display: true,
        details: { states },
      });
    },
  });

  pi.registerCommand("insights", {
    description: "Show recent shared insights",
    async handler() {
      const insights = await (await getMemory()).listRecentInsights(10);
      const text =
        insights.length === 0
          ? "No insights."
          : insights.map((i) => `- ${i.content}`).join("\n");
      pi.sendMessage({
        customType: "insights-list",
        content: [{ type: "text", text }],
        display: true,
        details: { insights },
      });
    },
  });

  pi.registerCommand("delegate", {
    description: "Force delegation of a task to sub-agents",
    async handler(args) {
      const goal = args.trim();
      if (!goal) {
        pi.sendMessage({
          customType: "delegate-error",
          content: [{ type: "text", text: "Usage: /delegate <task>" }],
          display: true,
        });
        return;
      }
      const parts = goal
        .split(/[.!?]\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const tasks = (parts.length > 1 ? parts : [goal]).map((g) => ({
        goal: g,
        parentSessionId: "cli",
      }));
      const results = await getManager().delegate(tasks);
      const text = results.map((r) => `- ${r.result}`).join("\n");
      pi.sendMessage({
        customType: "delegate-result",
        content: [{ type: "text", text }],
        display: true,
        details: { results },
      });
    },
  });

  pi.registerTool({
    name: "list_subagents",
    label: "List sub-agents",
    description: "Показать все активные и недавно завершённые субагенты с их статусом и частичным результатом.",
    parameters: Type.Object({}),
    async execute(): Promise<AgentToolResult<{ states: SubAgentState[] }>> {
      const states = getManager().listAll();
      const text =
        states.length === 0
          ? "No sub-agents."
          : states
              .map((s) => `- ${s.status}: ${s.goal}${s.partialResult ? ` (partial: ${s.partialResult})` : ""} (${s.taskId})`)
              .join("\n");
      return { content: [{ type: "text", text }], details: { states } };
    },
  });

  pi.registerTool({
    name: "steer_subagent",
    label: "Steer sub-agent",
    description: "Скорректировать или остановить работающего субагента.",
    parameters: Type.Object({
      taskId: Type.String(),
      message: Type.String(),
      action: Type.Union([
        Type.Literal("continue"),
        Type.Literal("redirect"),
        Type.Literal("stop"),
      ]),
    }),
    async execute(
      _toolCallId: string,
      params: { taskId: string; message: string; action: "continue" | "redirect" | "stop" },
    ): Promise<AgentToolResult<{ state: SubAgentState | null }>> {
      await getManager().steer(params.taskId, {
        taskId: params.taskId,
        message: params.message,
        action: params.action,
      });
      const state = getManager().getState(params.taskId);
      return {
        content: [{ type: "text", text: `Sub-agent ${params.taskId}: ${params.action}.` }],
        details: { state },
      };
    },
  });

  pi.registerCommand("steer", {
    description: "Redirect a running sub-agent",
    async handler(args) {
      const [taskId, ...rest] = args.trim().split(/\s+/);
      const message = rest.join(" ");
      if (!taskId || !message) {
        pi.sendMessage({
          customType: "steer-error",
          content: [{ type: "text", text: "Usage: /steer <taskId> <message>" }],
          display: true,
        });
        return;
      }
      await getManager().steer(taskId, { taskId, message, action: "redirect" });
      pi.sendMessage({
        customType: "steer-done",
        content: [{ type: "text", text: `Redirected ${taskId}: ${message}` }],
        display: true,
      });
    },
  });

  pi.registerCommand("stop", {
    description: "Stop a running sub-agent and keep its partial result",
    async handler(args) {
      const taskId = args.trim();
      if (!taskId) {
        pi.sendMessage({
          customType: "stop-error",
          content: [{ type: "text", text: "Usage: /stop <taskId>" }],
          display: true,
        });
        return;
      }
      const result = await getManager().stop(taskId, true);
      pi.sendMessage({
        customType: "stop-done",
        content: [{ type: "text", text: `Stopped ${taskId}. Partial result: ${result.result}` }],
        display: true,
        details: { result },
      });
    },
  });
}
