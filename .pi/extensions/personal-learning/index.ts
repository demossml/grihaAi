import path from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { UserProfileService } from "../sqlite-rag-memory/UserProfileService.js";
import { ClientNotesService } from "../sqlite-rag-memory/ClientNotesService.js";
import {
  applyLearning,
  extractLearning,
  isExtractionEmpty,
  summarizeExtraction,
  type LearningLlm,
} from "../../../src/utils/learning-extractor.js";
import { formatPersonalContext } from "../../../src/utils/personal-context.js";
import type { ClientNote, UserProfile } from "../../../src/types/index.js";

const DB_PATH = path.join(homedir(), ".grish-ai", "memory.sqlite");
const OWNER_ID = "owner";

let autoLearnInProgress = false;

let profiles: UserProfileService | null = null;
let notes: ClientNotesService | null = null;

async function getProfiles(): Promise<UserProfileService> {
  if (!profiles) {
    profiles = new UserProfileService(DB_PATH);
    await profiles.init();
  }
  return profiles;
}

async function getNotes(): Promise<ClientNotesService> {
  if (!notes) {
    notes = new ClientNotesService(DB_PATH);
    await notes.init();
  }
  return notes;
}

/**
 * Emulated extraction LLM — returns an empty extraction. Swap for a real,
 * cheap LLM call (ctx.modelRegistry) later.
 */
const emulatedLlm: LearningLlm = async () =>
  JSON.stringify({ facts: [], preferences: {}, notes: [] });

function collectRecentDialog(entries: readonly unknown[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if ((entry as { type?: unknown }).type !== "message") continue;
    const msg = (entry as { message?: { role?: string; content?: unknown } }).message;
    if (!msg) continue;
    const role = msg.role ?? "?";
    const content = msg.content;
    if (typeof content === "string") {
      lines.push(`${role}: ${content}`);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: string }).type === "text"
        ) {
          lines.push(`${role}: ${(part as { text?: string }).text ?? ""}`);
        }
      }
    }
  }
  return lines.slice(-20).join("\n");
}

async function maybeAutoLearn(ctx: ExtensionContext): Promise<void> {
  if (autoLearnInProgress || !ctx.hasUI) return;
  const dialog = collectRecentDialog(ctx.sessionManager.getEntries());
  if (!dialog.trim()) return;

  autoLearnInProgress = true;
  try {
    const extraction = await extractLearning(dialog, emulatedLlm);
    if (isExtractionEmpty(extraction)) return;

    const ok = await ctx.ui.confirm("Сохранить извлечённое?", summarizeExtraction(extraction));
    if (!ok) return;

    await applyLearning(extraction, OWNER_ID, await getProfiles(), await getNotes());
    ctx.ui.notify("Обучение сохранено.", "info");
  } finally {
    autoLearnInProgress = false;
  }
}

export default function personalLearning(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    await getProfiles();
    await getNotes();
  });

  pi.on("before_agent_start", async (event) => {
    const profile = await (await getProfiles()).getProfile(OWNER_ID);
    const recentNotes = await (await getNotes()).listNotes(OWNER_ID);
    const section = formatPersonalContext(profile, recentNotes);
    if (!section) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${section}` };
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await maybeAutoLearn(ctx);
  });

  pi.registerTool({
    name: "get_user_profile",
    label: "Get user profile",
    description: "Получить профиль пользователя.",
    parameters: Type.Object({ userId: Type.Optional(Type.String()) }),
    async execute(_id: string, params: { userId?: string }): Promise<AgentToolResult<{ profile: UserProfile | null }>> {
      const profile = await (await getProfiles()).getProfile(params.userId ?? OWNER_ID);
      const text = profile ? JSON.stringify(profile, null, 2) : "No profile.";
      return { content: [{ type: "text", text }], details: { profile } };
    },
  });

  pi.registerTool({
    name: "update_user_profile",
    label: "Update user profile",
    description: "Обновить профиль пользователя.",
    parameters: Type.Object({
      userId: Type.Optional(Type.String()),
      displayName: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
      timezone: Type.Optional(Type.String()),
      language: Type.Optional(Type.String()),
      communicationStyle: Type.Optional(Type.String()),
      preferences: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    async execute(
      _id: string,
      params: {
        userId?: string;
        displayName?: string;
        role?: string;
        timezone?: string;
        language?: string;
        communicationStyle?: string;
        preferences?: Record<string, string>;
      },
    ): Promise<AgentToolResult<{ profile: UserProfile }>> {
      const { userId, ...patch } = params;
      const profile = await (await getProfiles()).upsertProfile(userId ?? OWNER_ID, patch);
      return { content: [{ type: "text", text: `Profile updated for ${profile.userId}.` }], details: { profile } };
    },
  });

  pi.registerTool({
    name: "add_client_note",
    label: "Add client note",
    description: "Добавить заметку о клиенте.",
    parameters: Type.Object({
      userId: Type.Optional(Type.String()),
      content: Type.String(),
      category: Type.Optional(
        Type.Union([
          Type.Literal("preference"),
          Type.Literal("procedure"),
          Type.Literal("style"),
          Type.Literal("other"),
        ]),
      ),
    }),
    async execute(
      _id: string,
      params: { userId?: string; content: string; category?: ClientNote["category"] },
    ): Promise<AgentToolResult<{ note: ClientNote }>> {
      const note = await (await getNotes()).addNote({
        userId: params.userId ?? OWNER_ID,
        content: params.content,
        category: params.category ?? "other",
        source: "manual",
      });
      return { content: [{ type: "text", text: `Note added (${note.id}).` }], details: { note } };
    },
  });

  pi.registerTool({
    name: "list_client_notes",
    label: "List client notes",
    description: "Показать заметки о клиенте.",
    parameters: Type.Object({ userId: Type.Optional(Type.String()) }),
    async execute(_id: string, params: { userId?: string }): Promise<AgentToolResult<{ notes: ClientNote[] }>> {
      const list = await (await getNotes()).listNotes(params.userId ?? OWNER_ID);
      const text =
        list.length === 0 ? "No notes." : list.map((n) => `- [${n.category}] ${n.content}`).join("\n");
      return { content: [{ type: "text", text }], details: { notes: list } };
    },
  });

  pi.registerTool({
    name: "extract_learning",
    label: "Extract learning",
    description: "Извлечь факты, предпочтения и заметки из диалога и сохранить.",
    parameters: Type.Object({ dialog: Type.String() }),
    async execute(
      _id: string,
      params: { dialog: string },
    ): Promise<AgentToolResult<{ extraction: unknown; saved: { preferencesSaved: number; notesSaved: number } }>> {
      const extraction = await extractLearning(params.dialog, emulatedLlm);
      const saved = await applyLearning(extraction, OWNER_ID, await getProfiles(), await getNotes());
      return {
        content: [
          {
            type: "text",
            text: `Извлечено фактов: ${extraction.facts.length}, предпочтений: ${Object.keys(extraction.preferences).length}, заметок: ${extraction.notes.length}.`,
          },
        ],
        details: { extraction, saved },
      };
    },
  });

  pi.registerCommand("profile", {
    description: "Show the user profile",
    async handler() {
      const profile = await (await getProfiles()).getProfile(OWNER_ID);
      const text = profile ? formatPersonalContext(profile, []) : "No profile yet.";
      pi.sendMessage({ customType: "profile", content: [{ type: "text", text }], display: true, details: { profile } });
    },
  });

  pi.registerCommand("notes", {
    description: "List client notes",
    async handler() {
      const list = await (await getNotes()).listNotes(OWNER_ID);
      const text = list.length === 0 ? "No notes." : list.map((n) => `- [${n.category}] ${n.content}`).join("\n");
      pi.sendMessage({ customType: "notes-list", content: [{ type: "text", text }], display: true, details: { notes: list } });
    },
  });

  pi.registerCommand("learn", {
    description: "Extract learning from the recent conversation",
    async handler(_args, ctx) {
      const dialog = collectRecentDialog(ctx.sessionManager.getEntries());
      if (!dialog.trim()) {
        pi.sendMessage({ customType: "learn-empty", content: [{ type: "text", text: "No conversation to learn from." }], display: true });
        return;
      }
      const extraction = await extractLearning(dialog, emulatedLlm);
      const saved = await applyLearning(extraction, OWNER_ID, await getProfiles(), await getNotes());
      pi.sendMessage({
        customType: "learn-result",
        content: [
          {
            type: "text",
            text: `Извлечено: ${extraction.facts.length} фактов, ${Object.keys(extraction.preferences).length} предпочтений, ${extraction.notes.length} заметок. Сохранено: ${saved.preferencesSaved} предпочтений, ${saved.notesSaved} заметок.`,
          },
        ],
        display: true,
        details: { extraction, saved },
      });
    },
  });
}
