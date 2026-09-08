import type { ClientNote, UserProfile } from "../../types/index.js";

/** Compact block for the system prompt / context. */
export function formatPersonalContext(
  profile: UserProfile | null,
  notes: ClientNote[],
): string {
  const parts: string[] = [];

  if (profile) {
    const lines = ["## Профиль пользователя"];
    if (profile.displayName) lines.push(`Имя: ${profile.displayName}`);
    if (profile.role) lines.push(`Роль: ${profile.role}`);
    if (profile.communicationStyle) lines.push(`Стиль: ${profile.communicationStyle}`);
    if (profile.language) lines.push(`Язык: ${profile.language}`);
    const prefs = Object.entries(profile.preferences);
    if (prefs.length > 0) {
      lines.push(`Предпочтения: ${prefs.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    }
    parts.push(lines.join("\n"));
  }

  if (notes.length > 0) {
    parts.push(["## Заметки", ...notes.map((n) => `- ${n.content}`)].join("\n"));
  }

  return parts.join("\n\n");
}
