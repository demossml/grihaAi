import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildRetrievalTrace, getActiveTrace } from "../../../src/runtime/observability/index.js";
import { SqliteRagMemoryService } from "./MemoryService.js";
import {
  MemoryAddSchema,
  MemoryDeleteSchema,
  MemorySearchSchema,
  type MemoryAddParams,
  type MemoryDeleteParams,
  type MemorySearchParams,
  type SearchResult,
} from "../../../src/types/index.js";
import { createEmbeddingService } from "../../../src/utils/memory/embeddings.js";
import { detectSecret, secretReason } from "../../../src/utils/security/secret-filter.js";
import { loadConfig } from "@griha/config";

const DB_PATH = path.join(homedir(), ".grish-ai", "memory.sqlite");

let svc: SqliteRagMemoryService | null = null;

async function getService(): Promise<SqliteRagMemoryService> {
  if (!svc) {
    svc = new SqliteRagMemoryService(createEmbeddingService(loadConfig()));
    await svc.init(DB_PATH);
  }
  return svc;
}

export default function sqliteRagMemory(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    await getService();
  });

  pi.on("session_shutdown", async () => {
    if (svc) {
      await svc.close();
      svc = null;
    }
  });

  pi.registerTool({
    name: "memory_add",
    label: "Add memory",
    description: "Persist a durable fact into long-term memory.",
    parameters: MemoryAddSchema,
    async execute(
      _toolCallId: string,
      params: MemoryAddParams,
    ): Promise<AgentToolResult<{ id: string }>> {
      // Privacy data hygiene: never persist secrets to long-term memory.
      const secret = detectSecret(params.content);
      if (secret) {
        return {
          content: [{ type: "text", text: secretReason(secret) }],
          details: { id: "" },
        };
      }
      const service = await getService();
      const fact = await service.addFact({
        content: params.content,
        category: params.category,
        projectId: params.projectId,
        botId: params.botId,
      });
      return {
        content: [{ type: "text", text: `Stored memory ${fact.id}` }],
        details: { id: fact.id },
      };
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "Search memory",
    description: "Search long-term memory for relevant facts.",
    parameters: MemorySearchSchema,
    async execute(
      _toolCallId: string,
      params: MemorySearchParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ results: SearchResult[] }>> {
      const service = await getService();
      const startedAt = Date.now();
      const { results, candidatesCount } = await service.searchWithStats(params.query, {
        limit: params.limit,
        projectId: params.projectId,
        category: params.category,
        botId: params.botId,
      });

      // Prompt 04: retrieval step в активный trace (ID + counts + latency).
      try {
        const manager = getActiveTrace(ctx.sessionManager.getSessionId());
        if (manager) {
          manager.addStep({
            type: "retrieval",
            status: "success",
            metadata: {
              retrieval: buildRetrievalTrace({
                queryId: randomUUID(),
                queryType: "memory",
                queryText: params.query,
                candidatesCount,
                selectedSourceIds: results.map((r) => r.id),
                durationMs: Date.now() - startedAt,
              }),
            },
          });
        }
      } catch {
        // retrieval trace никогда не ломает tool.
      }

      const text =
        results.length === 0
          ? "No matching memories."
          : results.map((r) => `- [${r.score.toFixed(3)}] ${r.content}`).join("\n");
      return {
        content: [{ type: "text", text }],
        details: { results },
      };
    },
  });

  pi.registerTool({
    name: "memory_delete",
    label: "Delete memory",
    description: "Delete a stored fact from long-term memory by id.",
    parameters: MemoryDeleteSchema,
    async execute(
      _toolCallId: string,
      params: MemoryDeleteParams,
    ): Promise<AgentToolResult<{ deleted: boolean }>> {
      const service = await getService();
      const deleted = await service.deleteFact(params.id);
      return {
        content: [
          {
            type: "text",
            text: deleted ? `Deleted memory ${params.id}` : `Memory ${params.id} not found.`,
          },
        ],
        details: { deleted },
      };
    },
  });

  pi.registerCommand("memory-reembed", {
    description: "Re-embed facts that are missing vectors",
    async handler() {
      const service = await getService();
      const count = await service.reembedMissing();
      pi.sendMessage({
        customType: "memory-reembed",
        content: [{ type: "text", text: `Re-embedded ${count} facts.` }],
        display: true,
        details: { count },
      });
    },
  });
}
