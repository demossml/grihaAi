import type { ClientNote } from "../types/index.js";

export interface LearningExtraction {
  facts: string[];
  preferences: Record<string, string>;
  notes: string[];
}

export type LearningLlm = (prompt: string) => Promise<string>;

export interface ProfileStore {
  setPreference(userId: string, key: string, value: string): Promise<void>;
}

export interface NotesStore {
  addNote(note: Omit<ClientNote, "id" | "createdAt" | "updatedAt">): Promise<ClientNote>;
}

const EXTRACTION_PROMPT = `Из этого разговора извлеки:
- новые факты о пользователе
- предпочтения по стилю/формату
- procedural notes (как лучше выполнять похожие задачи в будущем)

Верни строго JSON:
{
  "facts": ["..."],
  "preferences": { "key": "value" },
  "notes": ["..."]
}

Разговор:
`;

/** Ask the LLM to extract structured learning from a conversation. */
export async function extractLearning(
  dialog: string,
  llmCall: LearningLlm,
): Promise<LearningExtraction> {
  const raw = await llmCall(EXTRACTION_PROMPT + dialog);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { facts: [], preferences: {}, notes: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      facts?: unknown;
      preferences?: unknown;
      notes?: unknown;
    };
    return {
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.filter((f): f is string => typeof f === "string")
        : [],
      preferences:
        parsed.preferences && typeof parsed.preferences === "object"
          ? (parsed.preferences as Record<string, string>)
          : {},
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter((n): n is string => typeof n === "string")
        : [],
    };
  } catch {
    return { facts: [], preferences: {}, notes: [] };
  }
}

/** Persist extracted learning into the profile and client notes. */
export async function applyLearning(
  extraction: LearningExtraction,
  userId: string,
  profiles: ProfileStore,
  notes: NotesStore,
): Promise<{ preferencesSaved: number; notesSaved: number }> {
  let preferencesSaved = 0;
  for (const [key, value] of Object.entries(extraction.preferences)) {
    await profiles.setPreference(userId, key, value);
    preferencesSaved++;
  }

  let notesSaved = 0;
  for (const fact of extraction.facts) {
    await notes.addNote({ userId, content: fact, category: "other", source: "auto" });
    notesSaved++;
  }
  for (const note of extraction.notes) {
    await notes.addNote({ userId, content: note, category: "procedure", source: "auto" });
    notesSaved++;
  }

  return { preferencesSaved, notesSaved };
}

/** True when there is nothing worth saving. */
export function isExtractionEmpty(extraction: LearningExtraction): boolean {
  return (
    extraction.facts.length === 0 &&
    Object.keys(extraction.preferences).length === 0 &&
    extraction.notes.length === 0
  );
}

/** Compact human-readable summary for the confirmation dialog. */
export function summarizeExtraction(extraction: LearningExtraction): string {
  const lines: string[] = [];
  if (extraction.facts.length > 0) {
    lines.push(`Факты:\n${extraction.facts.map((f) => `- ${f}`).join("\n")}`);
  }
  const prefs = Object.entries(extraction.preferences);
  if (prefs.length > 0) {
    lines.push(`Предпочтения:\n${prefs.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`);
  }
  if (extraction.notes.length > 0) {
    lines.push(`Заметки:\n${extraction.notes.map((n) => `- ${n}`).join("\n")}`);
  }
  return lines.join("\n\n");
}
