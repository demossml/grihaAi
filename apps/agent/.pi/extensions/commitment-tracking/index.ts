import path from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";
import {
  CommitmentAddSchema,
  CommitmentListSchema,
  CommitmentUpdateSchema,
  type Commitment,
  type CommitmentAddParams,
  type CommitmentListParams,
  type CommitmentUpdateParams,
} from "../../../src/types/index.js";
import { CommitmentService } from "./CommitmentService.js";
import { getSessionContext } from "../user-rules/context.js";

const DB_PATH = path.join(getConfigDir(), "commitments.sqlite");

let svc: CommitmentService | null = null;

function getService(): CommitmentService {
  if (!svc) {
    svc = new CommitmentService(DB_PATH);
    svc.init();
  }
  return svc;
}

function resolveUserId(ctx: ExtensionContext): string {
  return getSessionContext(ctx.sessionManager.getSessionId())?.userId ?? "owner";
}

function format(c: Commitment): string {
  const due = c.dueDate ? ` (до ${c.dueDate.slice(0, 10)})` : "";
  return `- [${c.status}] ${c.text}${due}`;
}

export default function commitmentTracking(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    getService();
  });

  pi.on("session_shutdown", () => {
    if (svc) {
      svc.close();
      svc = null;
    }
  });

  pi.registerTool({
    name: "commitment_add",
    label: "Add commitment",
    description:
      "Зафиксировать обязательство (кто, что, кому, дедлайн). При низкой уверенности в деталях — сначала уточни у пользователя.",
    parameters: CommitmentAddSchema,
    async execute(
      _toolCallId: string,
      params: CommitmentAddParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string; status?: string }>> {
      const commitment = getService().add({
        userId: resolveUserId(ctx),
        text: params.text,
        who: params.who,
        toWhom: params.toWhom,
        dueDate: params.dueDate,
        confidence: params.confidence,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        contactId: params.contactId,
        meetingId: params.meetingId,
      });
      return {
        content: [{ type: "text", text: `Commitment ${commitment.id} created (${commitment.status}).` }],
        details: { id: commitment.id, status: commitment.status },
      };
    },
  });

  pi.registerTool({
    name: "commitment_list",
    label: "List commitments",
    description: "Список обязательств пользователя (опционально по статусу).",
    parameters: CommitmentListSchema,
    async execute(
      _toolCallId: string,
      params: CommitmentListParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ commitments: Commitment[] }>> {
      const service = getService();
      service.refreshStatuses();
      const commitments = service.list(resolveUserId(ctx), {
        status: params.status,
        limit: params.limit,
      });
      const text =
        commitments.length === 0
          ? "Обязательств нет."
          : commitments.map(format).join("\n");
      return {
        content: [{ type: "text", text }],
        details: { commitments },
      };
    },
  });

  pi.registerTool({
    name: "commitment_update",
    label: "Update commitment",
    description: "Обновить текст/дедлайн/статус обязательства.",
    parameters: CommitmentUpdateSchema,
    async execute(
      _toolCallId: string,
      params: CommitmentUpdateParams,
    ): Promise<AgentToolResult<{ updated: boolean }>> {
      const updated = getService().update(params.id, {
        text: params.text,
        status: params.status,
        dueDate: params.dueDate,
      });
      return {
        content: [{ type: "text", text: updated ? "Commitment updated." : "Commitment not found." }],
        details: { updated: Boolean(updated) },
      };
    },
  });

  pi.registerTool({
    name: "commitment_complete",
    label: "Complete commitment",
    description: "Отметить обязательство выполненным.",
    parameters: CommitmentUpdateSchema,
    async execute(
      _toolCallId: string,
      params: CommitmentUpdateParams,
    ): Promise<AgentToolResult<{ updated: boolean }>> {
      const updated = getService().update(params.id, { status: "completed" });
      return {
        content: [{ type: "text", text: updated ? "Commitment completed." : "Commitment not found." }],
        details: { updated: Boolean(updated) },
      };
    },
  });

  pi.registerTool({
    name: "commitment_cancel",
    label: "Cancel commitment",
    description: "Отменить обязательство.",
    parameters: CommitmentUpdateSchema,
    async execute(
      _toolCallId: string,
      params: CommitmentUpdateParams,
    ): Promise<AgentToolResult<{ updated: boolean }>> {
      const updated = getService().update(params.id, { status: "cancelled" });
      return {
        content: [{ type: "text", text: updated ? "Commitment cancelled." : "Commitment not found." }],
        details: { updated: Boolean(updated) },
      };
    },
  });
}
