import type { UserRule } from "@griha/shared-types";
import { type UserRulesService } from "./UserRulesService.js";

export interface RulesCommandContext {
  chatId?: string;
  userId?: string;
}

function formatRule(r: UserRule): string {
  const scope = r.scope === "chat" ? `chat:${r.chatId ?? "?"}` : "global";
  const owner = r.ownerUserId ? ` owner:${r.ownerUserId}` : "";
  return `- [${r.enabled ? "on" : "off"}] ${r.id.slice(0, 8)} [${scope}] [${r.kind}]${owner} ${r.text}`;
}

function resolveRule(svc: UserRulesService, idOrPrefix: string): UserRule | null {
  const exact = svc.get(idOrPrefix);
  if (exact) return exact;
  return svc.list({ enabledOnly: false }).find((r) => r.id.startsWith(idOrPrefix)) ?? null;
}

/**
 * Shared /rules command logic. Used by the pi slash command (scope=global) and
 * by the Telegram bridge (scope=chat + ownerUserId auto-substituted).
 */
export function runRulesCommand(
  svc: UserRulesService,
  args: string,
  ctx: RulesCommandContext = {},
): string {
  const [sub, ...rest] = args.trim().split(/\s+/);

  if (!sub || sub === "list") {
    const rules = svc.list({ chatId: ctx.chatId, enabledOnly: false });
    if (rules.length === 0) return "Нет правил.";
    return rules.map(formatRule).join("\n");
  }

  if (sub === "add") {
    const text = rest.join(" ");
    if (!text) return "Usage: /rules add <текст правила>";
    const rule = svc.add({
      scope: ctx.chatId ? "chat" : "global",
      chatId: ctx.chatId,
      text,
      ownerUserId: ctx.userId,
    });
    return `Добавлено правило ${rule.id.slice(0, 8)} [${rule.kind}] (${rule.scope}): ${rule.text}`;
  }

  if (sub === "delete") {
    const id = rest[0];
    if (!id) return "Usage: /rules delete <id>";
    const rule = resolveRule(svc, id);
    if (!rule) return `Правило "${id}" не найдено.`;
    svc.delete(rule.id);
    return `Правило ${rule.id.slice(0, 8)} удалено.`;
  }

  if (sub === "on" || sub === "off") {
    const id = rest[0];
    if (!id) return `Usage: /rules ${sub} <id>`;
    const rule = resolveRule(svc, id);
    if (!rule) return `Правило "${id}" не найдено.`;
    svc.setEnabled(rule.id, sub === "on");
    return `Правило ${rule.id.slice(0, 8)} ${sub === "on" ? "включено" : "выключено"}.`;
  }

  return "Неизвестная подкоманда. Используй: /rules list|add|delete|on|off";
}
