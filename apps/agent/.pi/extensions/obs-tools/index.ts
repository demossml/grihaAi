/**
 * obs-tools — tools чтения журнала наблюдаемости (JSONL) для агента.
 * Без LLM внутри tool: только чтение JSONL через @griha/observability.
 * ACL: только owner/admin (canManage) — журнал может содержать метаданные
 * чатов/пользователей (redact-нутые, но операторский доступ по дефолту).
 */
import { Type } from "typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSessionContext } from "../user-rules/context.js";
import { getUsersService } from "../../../src/services/UsersService.js";
import { readObsEvents, summarizeObsEvents } from "@griha/observability";

const DENIED = "Только для оператора (owner/admin).";

function resolveUserId(ctx: ExtensionContext): string {
  return getSessionContext(ctx.sessionManager.getSessionId())?.userId ?? "";
}

async function allowed(ctx: ExtensionContext): Promise<boolean> {
  const userId = resolveUserId(ctx);
  if (!userId) return false;
  return getUsersService().canManage(userId);
}

export default function obsTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "obs_query",
    label: "Query observability log",
    description:
      "Прочитать журнал наблюдаемости Griha (JSONL, без LLM). " +
      "Используй когда пользователь спрашивает почему бот молчал, не ушёл отчёт, " +
      "или что происходило в системе. Не выдумывай события — только результат tool. " +
      "Почему молчал: gate.block + chatId (reason). Один ход целиком: correlationId. " +
      "Бюджет: event generation.budget / generation.finish. Префикс: eventPrefix (например generation.). " +
      "only for operator/owner.",
    parameters: Type.Object({
      event: Type.Optional(Type.String({ description: "exact event name" })),
      eventPrefix: Type.Optional(Type.String({ description: "event prefix (startsWith)" })),
      component: Type.Optional(Type.String({ description: "exact component" })),
      chatId: Type.Optional(Type.String()),
      correlationId: Type.Optional(Type.String()),
      code: Type.Optional(Type.String({ description: "машинный код ошибки/логики" })),
      sinceMinutes: Type.Optional(Type.Number({ description: "default 60, min 1, max 1440" })),
      limit: Type.Optional(Type.Number({ description: "default 30, max 100" })),
    }),
    async execute(
      _id: string,
      params: {
        event?: string;
        eventPrefix?: string;
        component?: string;
        chatId?: string;
        correlationId?: string;
        code?: string;
        sinceMinutes?: number;
        limit?: number;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ count: number; events: unknown[] }>> {
      if (!(await allowed(ctx))) {
        return { content: [{ type: "text", text: DENIED }], details: { count: 0, events: [] } };
      }
      const sinceMinutes = Math.min(Math.max(params.sinceMinutes ?? 60, 1), 24 * 60);
      const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
      const events = readObsEvents({
        filter: {
          event: params.event,
          eventPrefix: params.eventPrefix,
          component: params.component,
          chatId: params.chatId,
          correlationId: params.correlationId,
          code: params.code,
          sinceMinutes,
          limit,
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ count: events.length, events }) }],
        details: { count: events.length, events },
      };
    },
  });

  pi.registerTool({
    name: "obs_summary",
    label: "Observability summary",
    description:
      "Краткая сводка журнала obs за период: счётчики event/component и последние ошибки. " +
      "Для ответа пользователю «что сломалось» сначала вызови этот tool. only for operator/owner.",
    parameters: Type.Object({
      sinceMinutes: Type.Optional(Type.Number({ description: "default 60" })),
      chatId: Type.Optional(Type.String()),
    }),
    async execute(
      _id: string,
      params: { sinceMinutes?: number; chatId?: string },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      if (!(await allowed(ctx))) {
        return { content: [{ type: "text", text: DENIED }], details: { total: 0 } };
      }
      const sinceMinutes = Math.min(Math.max(params.sinceMinutes ?? 60, 1), 24 * 60);
      const events = readObsEvents({
        filter: { sinceMinutes, chatId: params.chatId, limit: 200 },
      });
      const summary = summarizeObsEvents(events);
      return {
        content: [{ type: "text", text: JSON.stringify(summary) }],
        details: summary,
      };
    },
  });
}
