import type {
  AgentToolResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { UserRule } from "@griha/shared-types";
import {
  RulesAddSchema,
  RulesDeleteSchema,
  RulesEditSchema,
  RulesGetSchema,
  RulesListSchema,
  type RulesAddParams,
  type RulesDeleteParams,
  type RulesEditParams,
  type RulesGetParams,
  type RulesListParams,
} from "../../../src/types/index.js";
import { getSessionContext } from "./context.js";
import { getUserRulesService } from "./UserRulesService.js";
import { runRulesCommand } from "./commands.js";
import { formatSoftRulesForPrompt } from "../chat-setup/RulePresets.js";

function formatRule(r: UserRule): string {
  const scope = r.scope === "chat" ? `chat:${r.chatId ?? "?"}` : "global";
  const owner = r.ownerUserId ? ` owner:${r.ownerUserId}` : "";
  return `- [${r.enabled ? "on" : "off"}] ${r.id.slice(0, 8)} [${scope}] [${r.kind}]${owner} ${r.text}`;
}

/**
 * Telegram /rules handler — auto-substitutes chat scope, chat_id and
 * ownerUserId (from.id). Exported for the telegram-bot extension.
 */
export function telegramRulesHandler(
  args: string,
  ctx: { chatId: string; userId: string },
): string {
  return runRulesCommand(getUserRulesService(), args, ctx);
}

export default function userRules(pi: ExtensionAPI): void {
  // Layer 2 — inject soft rules (and Telegram chat context) into the prompt.
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const tctx = getSessionContext(sessionId);
    const svc = getUserRulesService();
    const soft = svc.getSoftRules(tctx?.chatId);

    const blocks: string[] = [];
    if (soft.length > 0) {
      blocks.push(["## User Rules (must follow)", ...soft.map((r) => `- ${r.text}`)].join("\n"));
    }
    // Structured soft keys (пресеты чата): коротко, не простыня (§10).
    const structuredSoft = formatSoftRulesForPrompt(soft);
    if (structuredSoft) {
      blocks.push(`## Chat mode\n${structuredSoft}`);
    }
    if (tctx) {
      blocks.push(`## Telegram context\n- chat_id: ${tctx.chatId}\n- user_id: ${tctx.userId}`);
    }
    if (blocks.length === 0) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${blocks.join("\n\n")}` };
  });

  pi.registerTool({
    name: "rules_list",
    label: "List user rules",
    description: "Показать правила поведения (фильтр: scope, chat_id, enabled).",
    parameters: RulesListSchema,
    async execute(_id: string, params: RulesListParams): Promise<AgentToolResult<{ rules: UserRule[] }>> {
      const rules = getUserRulesService().list({
        scope: params.scope,
        chatId: params.chatId,
        enabledOnly: params.enabledOnly,
      });
      const text = rules.length === 0 ? "No rules." : rules.map(formatRule).join("\n");
      return { content: [{ type: "text", text }], details: { rules } };
    },
  });

  pi.registerTool({
    name: "rules_add",
    label: "Add user rule",
    description: "Создать правило поведения. kind: hard (проверяется без LLM) или soft (стиль/тон).",
    parameters: RulesAddSchema,
    async execute(_id: string, params: RulesAddParams): Promise<AgentToolResult<{ rule: UserRule }>> {
      const rule = getUserRulesService().add({
        scope: params.scope,
        chatId: params.chatId,
        text: params.text,
        kind: params.kind,
        ownerUserId: params.ownerUserId,
      });
      return {
        content: [{ type: "text", text: `Rule added ${rule.id.slice(0, 8)} [${rule.kind}] ${rule.scope}: ${rule.text}` }],
        details: { rule },
      };
    },
  });

  pi.registerTool({
    name: "rules_edit",
    label: "Edit user rule",
    description: "Изменить текст / enabled / kind правила.",
    parameters: RulesEditSchema,
    async execute(_id: string, params: RulesEditParams): Promise<AgentToolResult<{ rule: UserRule | null }>> {
      const rule = getUserRulesService().edit(params.id, {
        text: params.text,
        enabled: params.enabled,
        kind: params.kind,
      });
      return {
        content: [{ type: "text", text: rule ? `Rule ${rule.id.slice(0, 8)} updated.` : "Rule not found." }],
        details: { rule },
      };
    },
  });

  pi.registerTool({
    name: "rules_delete",
    label: "Delete user rule",
    description: "Удалить правило по id.",
    parameters: RulesDeleteSchema,
    async execute(_id: string, params: RulesDeleteParams): Promise<AgentToolResult<{ deleted: boolean }>> {
      const deleted = getUserRulesService().delete(params.id);
      return {
        content: [{ type: "text", text: deleted ? `Rule ${params.id} deleted.` : "Rule not found." }],
        details: { deleted },
      };
    },
  });

  pi.registerTool({
    name: "rules_get",
    label: "Get user rule",
    description: "Получить одно правило по id.",
    parameters: RulesGetSchema,
    async execute(_id: string, params: RulesGetParams): Promise<AgentToolResult<{ rule: UserRule | null }>> {
      const rule = getUserRulesService().get(params.id);
      return {
        content: [{ type: "text", text: rule ? formatRule(rule) : "Rule not found." }],
        details: { rule },
      };
    },
  });

  pi.registerCommand("rules", {
    description: "Manage user rules: list / add / delete / on / off",
    async handler(args) {
      const text = runRulesCommand(getUserRulesService(), args);
      pi.sendMessage({ customType: "rules", content: [{ type: "text", text }], display: true });
    },
  });
}
