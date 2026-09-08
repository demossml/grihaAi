import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getConfigDir } from "@griha/config";
import type { LearningLlm } from "./learning-extractor.js";

export type SkillProposalKind = "core-edit" | "new-skill";
export type SkillProposalStatus = "pending" | "applied" | "rejected";

export interface SkillProposal {
  id: string;
  kind: SkillProposalKind;
  title: string;
  /** Skill directory name (new-skill only). */
  name?: string;
  /** Frontmatter description (new-skill only). */
  description?: string;
  /** Markdown body to append (core-edit) or skill body (new-skill). */
  content: string;
  status: SkillProposalStatus;
  createdAt: string;
  appliedAt?: string;
}

function proposalsDir(): string {
  return path.join(getConfigDir(), "skill-proposals");
}

/**
 * Durable, file-backed queue of review-gated skill proposals. Each proposal is
 * a single JSON file under `~/.grish-ai/skill-proposals/`. Proposals are
 * applied only after explicit user confirmation; without a UI they stay here
 * as `pending` for manual review (`/skills-approve` / `/skills-reject`).
 */
export class SkillProposalStore {
  constructor(private readonly dir: string = proposalsDir()) {}

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async save(proposal: SkillProposal): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.fileFor(proposal.id), JSON.stringify(proposal, null, 2), "utf8");
  }

  async get(id: string): Promise<SkillProposal | null> {
    try {
      const raw = await fs.readFile(this.fileFor(id), "utf8");
      return JSON.parse(raw) as SkillProposal;
    } catch {
      return null;
    }
  }

  async list(): Promise<SkillProposal[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const proposals: SkillProposal[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, entry), "utf8");
        proposals.push(JSON.parse(raw) as SkillProposal);
      } catch {
        // Skip unreadable files.
      }
    }
    return proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateStatus(id: string, status: SkillProposalStatus): Promise<SkillProposal | null> {
    const proposal = await this.get(id);
    if (!proposal) return null;
    const updated: SkillProposal = {
      ...proposal,
      status,
      appliedAt: status === "applied" ? new Date().toISOString() : proposal.appliedAt,
    };
    await this.save(updated);
    return updated;
  }
}

function buildSkillProposalPrompt(notes: string[]): string {
  return [
    "На основе накопленных заметок и фактов о пользователе предложи улучшение навыков Гриши.",
    "Верни строго JSON одного из трёх видов:",
    '1) Правка core skill: {"kind":"core-edit","title":"заголовок","content":"markdown-блок для добавления в skills/core/SKILL.md"}',
    '2) Новый skill: {"kind":"new-skill","name":"имя-каталога-без-пробелов","description":"короткое описание","title":"заголовок","content":"тело SKILL.md без frontmatter"}',
    '3) Ничего не предлагать: {"kind":"none"}',
    "",
    "Правила:",
    "- предлагай только повторяющиеся процедуры/предпочтения, подтверждённые заметками;",
    "- не предлагай хранить секреты/пароли;",
    "- если материала мало или ничего нового нет — верни {\"kind\":\"none\"}.",
    "",
    "Заметки:",
    ...notes.map((n) => `- ${n}`),
  ].join("\n");
}

/**
 * Parse an LLM response into a pending proposal. Returns null when the model
 * decided there is nothing to propose, or when the proposal touches protected
 * domains (security / approval / financial policy / permissions / restrictions)
 * — learning must never auto-propose changes to those.
 */
export function parseSkillProposal(raw: string, now: string = new Date().toISOString()): SkillProposal | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: { kind?: unknown; title?: unknown; name?: unknown; description?: unknown; content?: unknown };
  try {
    parsed = JSON.parse(match[0]) as typeof parsed;
  } catch {
    return null;
  }

  if (parsed.kind === "none" || parsed.kind === undefined) return null;
  if (parsed.kind !== "core-edit" && parsed.kind !== "new-skill") return null;

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if (!title || !content) return null;

  const proposal: SkillProposal = {
    id: randomUUID(),
    kind: parsed.kind,
    title,
    content,
    status: "pending",
    createdAt: now,
  };

  if (parsed.kind === "new-skill") {
    const name =
      typeof parsed.name === "string"
        ? parsed.name.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "")
        : "";
    if (!name) return null;
    proposal.name = name;
    proposal.description = typeof parsed.description === "string" ? parsed.description.trim() : title;
  }

  // Learning guard: never propose changes to protected domains.
  if (isProtectedSkillContent(`${proposal.title}\n${proposal.content}`, proposal.name)) {
    return null;
  }

  return proposal;
}

const PROTECTED_SKILL_NAMES = new Set([
  "human-approval-gate",
  "approval-thresholds",
  "privacy-data-hygiene",
  "delegation-triage",
]);

const PROTECTED_TERMS = [
  "approval",
  "security",
  "permission",
  "restriction",
  "financial policy",
  "approval policy",
  "security policy",
  "financial limit",
  "порог",
  "одобр",
  "разрешени",
  "ограничени",
  "безопасност",
];

/**
 * True when the proposed content/name targets a domain that learning must not
 * auto-modify (financial limits, permissions, restrictions, approval or
 * security policies).
 */
export function isProtectedSkillContent(text: string, name?: string): boolean {
  if (name && PROTECTED_SKILL_NAMES.has(name)) return true;
  const lower = text.toLowerCase();
  return PROTECTED_TERMS.some((t) => lower.includes(t));
}

/** Generate a review-gated skill proposal from accumulated notes. */
export async function proposeSkillImprovement(
  notes: string[],
  llm: LearningLlm,
): Promise<SkillProposal | null> {
  const raw = await llm(buildSkillProposalPrompt(notes));
  return parseSkillProposal(raw);
}

function skillFrontmatter(name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "autoCreated: true",
    "---",
  ].join("\n");
}

/**
 * Apply an approved proposal to the skills content on disk. Core edits are
 * appended to `skills/core/SKILL.md`; new skills create `skills/<name>/SKILL.md`
 * with `autoCreated: true` frontmatter.
 */
export async function applySkillProposal(
  proposal: SkillProposal,
  skillsRoot: string,
): Promise<string> {
  if (proposal.kind === "core-edit") {
    const target = path.join(skillsRoot, "core", "SKILL.md");
    const existing = await fs.readFile(target, "utf8").catch(() => "");
    const block = `\n\n## ${proposal.title}\n\n${proposal.content}\n`;
    await fs.writeFile(target, `${existing.replace(/\s+$/, "")}${block}`, "utf8");
    return target;
  }

  const name = proposal.name ?? "auto-skill";
  const dir = path.join(skillsRoot, name);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, "SKILL.md");
  await fs.writeFile(
    target,
    `${skillFrontmatter(name, proposal.description ?? proposal.title)}\n\n${proposal.content}\n`,
    "utf8",
  );
  return target;
}
