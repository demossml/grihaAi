import path from "node:path";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";
import {
  ApprovalGrantSchema,
  ApprovalPolicySetSchema,
  ApprovalRequestSchema,
  type ApprovalGrantParams,
  type ApprovalPolicySetParams,
  type ApprovalRequestParams,
  type ApprovalRequestRecord,
  type FinancialApprovalPolicy,
} from "../../../src/types/index.js";
import { requiresApproval } from "../../../src/utils/approval-policy.js";
import { ApprovalService } from "./ApprovalService.js";
import { getSessionContext } from "../user-rules/context.js";

const DB_PATH = path.join(getConfigDir(), "approvals.sqlite");

/** How long a pending approval stays valid before it must be re-requested. */
const APPROVAL_TTL_MS = 15 * 60 * 1000;

let svc: ApprovalService | null = null;

function getService(): ApprovalService {
  if (!svc) {
    svc = new ApprovalService(DB_PATH);
    svc.init();
  }
  return svc;
}

/** Resolve the identity of the current turn: Telegram chat context, else "owner". */
function resolveIdentity(ctx: ExtensionContext): { userId: string; chatId?: string } {
  const sessionId = ctx.sessionManager.getSessionId();
  const tctx = getSessionContext(sessionId);
  return tctx ? { userId: tctx.userId, chatId: tctx.chatId } : { userId: "owner" };
}

function formatRequest(r: ApprovalRequestRecord): string {
  const target = r.target ? ` (target: ${r.target})` : "";
  return `[${r.id.slice(0, 8)}] ${r.action}${target} — ${r.actionClass} — ${r.status}`;
}

export default function approvalGate(pi: ExtensionAPI): void {
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
    name: "approval_required",
    label: "Check approval",
    description:
      "Классифицировать действие и запросить подтверждение пользователя, если оно требуется (side-effect / high-risk / финансовое). Возвращает requestId, когда подтверждение обязательно.",
    parameters: ApprovalRequestSchema,
    async execute(
      _toolCallId: string,
      params: ApprovalRequestParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ required: boolean; requestId?: string; actionClass?: string; reason?: string }>> {
      const { userId, chatId } = resolveIdentity(ctx);
      const service = getService();
      const policy = service.getPolicy(userId, chatId);

      const args = params.arguments ?? {};
      const amount =
        typeof args.amount === "number"
          ? args.amount
          : typeof args.amount === "string" && args.amount.trim() !== ""
            ? Number(args.amount)
            : undefined;
      const category = typeof args.category === "string" ? args.category : undefined;

      const decision = requiresApproval(params.action, {
        amount,
        currency: typeof args.currency === "string" ? args.currency : undefined,
        category,
        policy,
      });

      if (!decision.required) {
        return {
          content: [{ type: "text", text: `No approval required: ${decision.reason}` }],
          details: { required: false, reason: decision.reason },
        };
      }

      const request = service.createRequest({
        userId,
        sessionId: ctx.sessionManager.getSessionId(),
        action: params.action,
        actionClass: decision.actionClass,
        target: params.target,
        args,
        scope: params.scope,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
      });

      return {
        content: [
          {
            type: "text",
            text: `Approval required for "${params.action}" (${decision.actionClass}, scope=${request.scope}).\nReason: ${decision.reason}\nRequest id: ${request.id}\nAsk the user to approve with /approve ${request.id.slice(0, 8)} or deny with /deny ${request.id.slice(0, 8)}. Do NOT perform the action until approval_status says approved.`,
          },
        ],
        details: {
          required: true,
          requestId: request.id,
          actionClass: decision.actionClass,
          reason: decision.reason,
        },
      };
    },
  });

  pi.registerTool({
    name: "approval_status",
    label: "Approval status",
    description: "Проверить статус запроса на подтверждение по requestId.",
    parameters: ApprovalGrantSchema,
    async execute(
      _toolCallId: string,
      params: ApprovalGrantParams,
    ): Promise<AgentToolResult<{ status?: string; action?: string }>> {
      const request = getService().get(params.id);
      if (!request) {
        return {
          content: [{ type: "text", text: "Approval request not found." }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: formatRequest(request) }],
        details: { status: request.status, action: request.action },
      };
    },
  });

  pi.registerTool({
    name: "approval_grant",
    label: "Grant approval",
    description: "Одобрить запрос на подтверждение. Вызывается только после явного согласия пользователя.",
    parameters: ApprovalGrantSchema,
    async execute(
      _toolCallId: string,
      params: ApprovalGrantParams,
    ): Promise<AgentToolResult<{ granted: boolean }>> {
      const granted = getService().grant(params.id);
      return {
        content: [
          { type: "text", text: granted ? "Approval granted." : "Approval request not pending or expired." },
        ],
        details: { granted },
      };
    },
  });

  pi.registerTool({
    name: "approval_deny",
    label: "Deny approval",
    description: "Отклонить запрос на подтверждение.",
    parameters: ApprovalGrantSchema,
    async execute(
      _toolCallId: string,
      params: ApprovalGrantParams,
    ): Promise<AgentToolResult<{ denied: boolean }>> {
      const denied = getService().deny(params.id);
      return {
        content: [{ type: "text", text: denied ? "Approval denied." : "Approval request not pending." }],
        details: { denied },
      };
    },
  });

  pi.registerTool({
    name: "approval_cancel",
    label: "Cancel approval",
    description: "Отменить запрос на подтверждение.",
    parameters: ApprovalGrantSchema,
    async execute(
      _toolCallId: string,
      params: ApprovalGrantParams,
    ): Promise<AgentToolResult<{ cancelled: boolean }>> {
      const cancelled = getService().cancel(params.id);
      return {
        content: [{ type: "text", text: cancelled ? "Approval cancelled." : "Approval request not pending." }],
        details: { cancelled },
      };
    },
  });

  pi.registerTool({
    name: "policy_get",
    label: "Get approval policy",
    description: "Прочитать текущую финансовую политику подтверждений пользователя.",
    parameters: Type.Object({}),
    async execute(
      _toolCallId: string,
      _params: Record<string, unknown>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ policy?: FinancialApprovalPolicy }>> {
      const { userId, chatId } = resolveIdentity(ctx);
      const policy = getService().getPolicy(userId, chatId);
      return {
        content: [
          {
            type: "text",
            text: policy ? JSON.stringify(policy) : "No approval policy set (default: confirm everything).",
          },
        ],
        details: { policy },
      };
    },
  });

  pi.registerTool({
    name: "policy_set",
    label: "Set approval policy",
    description: "Задать финансовую политику подтверждений (пороги и категории). Требует явного согласия пользователя.",
    parameters: ApprovalPolicySetSchema,
    async execute(
      _toolCallId: string,
      params: ApprovalPolicySetParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string }>> {
      const { userId, chatId } = resolveIdentity(ctx);
      const scope = params.scope ?? (params.chatId || chatId ? "chat" : "global");
      const record = getService().setPolicy({
        userId,
        scope,
        chatId: params.chatId ?? chatId,
        financial: params.financial,
      });
      return {
        content: [{ type: "text", text: `Approval policy saved (${scope}).` }],
        details: { id: record.id },
      };
    },
  });

  pi.registerCommand("approvals", {
    description: "Список pending-запросов на подтверждение",
    async handler(_args, ctx) {
      const { userId } = resolveIdentity(ctx);
      const pending = getService().listPending(userId);
      const text =
        pending.length === 0
          ? "Нет ожидающих подтверждений."
          : pending.map((r) => formatRequest(r)).join("\n");
      pi.sendMessage({ customType: "approvals", content: [{ type: "text", text }], display: true });
    },
  });

  pi.registerCommand("approve", {
    description: "Одобрить запрос по id: /approve <id>",
    async handler(args, ctx) {
      const id = resolveIdFromArgs(args, ctx);
      if (!id) {
        pi.sendMessage({ customType: "approve", content: [{ type: "text", text: "Укажите id: /approve <id>" }], display: true });
        return;
      }
      const ok = getService().grant(id);
      pi.sendMessage({
        customType: "approve",
        content: [{ type: "text", text: ok ? "Одобрено." : "Запрос не найден или уже решён." }],
        display: true,
      });
    },
  });

  pi.registerCommand("deny", {
    description: "Отклонить запрос по id: /deny <id>",
    async handler(args, ctx) {
      const id = resolveIdFromArgs(args, ctx);
      if (!id) {
        pi.sendMessage({ customType: "deny", content: [{ type: "text", text: "Укажите id: /deny <id>" }], display: true });
        return;
      }
      const ok = getService().deny(id);
      pi.sendMessage({
        customType: "deny",
        content: [{ type: "text", text: ok ? "Отклонено." : "Запрос не найден или уже решён." }],
        display: true,
      });
    },
  });
}

// Minimal empty-parameters schema.
function resolveIdFromArgs(args: unknown, ctx: ExtensionContext): string | undefined {
  const raw = typeof args === "string" ? args.trim() : "";
  // Full id lookup first, then unique-prefix match over pending requests.
  const service = getService();
  if (service.get(raw)) return raw;
  const { userId } = resolveIdentity(ctx);
  const matches = service.listPending(userId).filter((r) => r.id.startsWith(raw));
  return matches.length === 1 ? matches[0].id : undefined;
}
