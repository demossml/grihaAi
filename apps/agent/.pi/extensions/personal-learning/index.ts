import path from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "@griha/config";
import { getSkillsRoot } from "@griha/skills";
import { UserProfileService } from "../sqlite-rag-memory/UserProfileService.js";
import { ClientNotesService } from "../sqlite-rag-memory/ClientNotesService.js";
import {
  applyLearning,
  extractLearning,
  isExtractionEmpty,
  summarizeExtraction,
  type LearningLlm,
} from "../../../src/utils/learning/learning-extractor.js";
import { createHttpLearningLlm } from "../../../src/utils/learning/http-learning.js";
import {
  SkillProposalStore,
  applySkillProposal,
  proposeSkillImprovement,
  type SkillProposal,
} from "../../../src/utils/learning/skill-improver.js";
import { formatPersonalContext } from "../../../src/utils/learning/personal-context.js";
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
 * Emulated extraction LLM kept for offline/time-free unit tests. Production
 * uses `getLlm()` below — an OpenAI-compatible call with the configured model.
 */
export const emulatedLlm: LearningLlm = async () =>
  JSON.stringify({ facts: [], preferences: {}, notes: [] });

/** Real extraction LLM (configured model, never a hardcoded name). */
function getLlm(): LearningLlm {
  const cfg = loadConfig();
  if (!cfg) throw new Error("No config found — run /setup first.");
  return createHttpLearningLlm(cfg);
}

let proposals: SkillProposalStore | null = null;
function getProposals(): SkillProposalStore {
  if (!proposals) proposals = new SkillProposalStore();
  return proposals;
}

async function gatherNotes(): Promise<string[]> {
  return (await (await getNotes()).listNotes(OWNER_ID)).map((n) => n.content);
}

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
    const extraction = await extractLearning(dialog, getLlm());
    if (isExtractionEmpty(extraction)) return;

    const ok = await ctx.ui.confirm("Сохранить извлечённое?", summarizeExtraction(extraction));
    if (!ok) return;

    await applyLearning(extraction, OWNER_ID, await getProfiles(), await getNotes());
    ctx.ui.notify("Обучение сохранено.", "info");
  } catch {
    // Learning is best-effort — never break the agent on extraction errors.
  } finally {
    autoLearnInProgress = false;
  }
}

/**
 * Generate a skill-improvement proposal from accumulated notes and, when a UI
 * is available, apply it only after explicit user confirmation. Without a UI
 * the proposal stays `pending` in the durable queue for manual review.
 */
async function proposeAndConfirm(ctx?: ExtensionContext): Promise<SkillProposal | null> {
  const list = await gatherNotes();
  if (list.length === 0) return null;

  const proposal = await proposeSkillImprovement(list, getLlm());
  if (!proposal) return null;

  const store = getProposals();
  await store.save(proposal);

  if (ctx?.hasUI) {
    const ok = await ctx.ui.confirm(
      "Применить предложенное улучшение навыка?",
      `${proposal.title}\n\n${proposal.content}`,
    );
    if (ok) {
      await applySkillProposal(proposal, getSkillsRoot());
      const applied = await store.updateStatus(proposal.id, "applied");
      ctx.ui.notify(`Skill proposal "${proposal.title}" applied.`, "info");
      return applied ?? { ...proposal, status: "applied" as const };
    }
    await store.updateStatus(proposal.id, "rejected");
    return { ...proposal, status: "rejected" as const };
  }

  // No UI: queued for manual confirmation via /skills-approve.
  return proposal;
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
      const extraction = await extractLearning(params.dialog, getLlm());
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
      const extraction = await extractLearning(dialog, getLlm());
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

  pi.registerTool({
    name: "propose_skill_improvement",
    label: "Propose skill improvement",
    description: "На основе накопленных заметок предложить улучшение навыков (review-gated).",
    parameters: Type.Object({}),
    async execute(
      _id: string,
      _params: Record<string, never>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ proposal: SkillProposal | null }>> {
      const proposal = await proposeAndConfirm(ctx);
      const text = proposal
        ? `Proposal "${proposal.title}" (${proposal.id}) — status: ${proposal.status}.`
        : "No proposal generated.";
      return { content: [{ type: "text", text }], details: { proposal } };
    },
  });

  pi.registerTool({
    name: "list_skill_proposals",
    label: "List skill proposals",
    description: "Показать предложения по улучшению навыков (очередь на подтверждение).",
    parameters: Type.Object({}),
    async execute(): Promise<AgentToolResult<{ proposals: SkillProposal[] }>> {
      const list = await getProposals().list();
      const text =
        list.length === 0
          ? "No skill proposals."
          : list.map((p) => `- [${p.status}] ${p.title} (${p.id})`).join("\n");
      return { content: [{ type: "text", text }], details: { proposals: list } };
    },
  });

  pi.registerCommand("skills-improve", {
    description: "Propose a skill improvement from accumulated notes",
    async handler(_args, ctx) {
      try {
        const proposal = await proposeAndConfirm(ctx);
        pi.sendMessage({
          customType: "skills-improve",
          content: [
            {
              type: "text",
              text: proposal
                ? `Proposal "${proposal.title}" (${proposal.id}) — status: ${proposal.status}.`
                : "No proposal generated (not enough notes or nothing new).",
            },
          ],
          display: true,
          details: { proposal },
        });
      } catch (error) {
        pi.sendMessage({
          customType: "skills-improve-error",
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          display: true,
        });
      }
    },
  });

  pi.registerCommand("skills-proposals", {
    description: "List skill proposals awaiting review",
    async handler() {
      const list = await getProposals().list();
      const text =
        list.length === 0
          ? "No skill proposals."
          : list.map((p) => `- [${p.status}] ${p.title} (${p.id})`).join("\n");
      pi.sendMessage({ customType: "skills-proposals", content: [{ type: "text", text }], display: true, details: { proposals: list } });
    },
  });

  pi.registerCommand("skills-approve", {
    description: "Approve and apply a pending skill proposal",
    async handler(args) {
      const id = args.trim();
      if (!id) {
        pi.sendMessage({ customType: "skills-approve-error", content: [{ type: "text", text: "Usage: /skills-approve <id>" }], display: true });
        return;
      }
      const store = getProposals();
      const proposal = await store.get(id);
      if (!proposal) {
        pi.sendMessage({ customType: "skills-approve-error", content: [{ type: "text", text: `Proposal ${id} not found.` }], display: true });
        return;
      }
      if (proposal.status !== "pending") {
        pi.sendMessage({ customType: "skills-approve-error", content: [{ type: "text", text: `Proposal ${id} is already ${proposal.status}.` }], display: true });
        return;
      }
      const target = await applySkillProposal(proposal, getSkillsRoot());
      await store.updateStatus(id, "applied");
      pi.sendMessage({ customType: "skills-approve", content: [{ type: "text", text: `Applied "${proposal.title}" → ${target}` }], display: true });
    },
  });

  pi.registerCommand("skills-reject", {
    description: "Reject a pending skill proposal",
    async handler(args) {
      const id = args.trim();
      if (!id) {
        pi.sendMessage({ customType: "skills-reject-error", content: [{ type: "text", text: "Usage: /skills-reject <id>" }], display: true });
        return;
      }
      const store = getProposals();
      const proposal = await store.get(id);
      if (!proposal) {
        pi.sendMessage({ customType: "skills-reject-error", content: [{ type: "text", text: `Proposal ${id} not found.` }], display: true });
        return;
      }
      await store.updateStatus(id, "rejected");
      pi.sendMessage({ customType: "skills-reject", content: [{ type: "text", text: `Rejected "${proposal.title}" (${id}).` }], display: true });
    },
  });
}
