/**
 * Форматирование chat-scoped правил в контекст для модели (R-GR-3).
 * Hard-правила enforced в коде (prefilter) — модели сообщается только сводка;
 * soft-правила перечисляются для соблюдения стиля/политик.
 */
import type { UserRule } from "@griha/shared-types";

export function formatRulesContext(hard: UserRule[], soft: UserRule[]): string {
  const lines: string[] = [
    "[GROUP_RULES]",
    "Hard constraints are already enforced by the system prefilter.",
  ];
  for (const r of soft) {
    if (r.key && r.value !== undefined) {
      lines.push(`- ${r.key}=${String(r.value)}`);
    } else if (r.text) {
      lines.push(`- ${r.text}`);
    }
  }
  // Hard-ключи — только для осведомлённости модели (enforcement — в коде).
  for (const r of hard) {
    if (r.key) lines.push(`- hard:${r.key}=${String(r.value)}`);
  }
  lines.push("[/GROUP_RULES]");
  return lines.join("\n");
}
