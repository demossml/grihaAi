import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getConfigDir } from "@griha/config";
import type { LearningLlm } from "./learning-extractor.js";
import { isAgentRuntimeEnabled } from "../../runtime/index.js";
import { SkillVersionStore } from "../../runtime/skill/index.js";

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
  /** L4 explainability: краткое резюме предложения. */
  summary?: string;
  /** L4 explainability: причина (evidence count). */
  reason?: string;
  /** L4 explainability: затронутый skillId (undefined = new-skill). */
  affectedSkillId?: string;
  /** L4 explainability: оценка риска. */
  risk?: "low" | "medium";
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

/** True когда skillId входит в protected-список (L4 гейт). */
export function isProtectedSkillName(name?: string): boolean {
  if (!name) return false;
  return PROTECTED_SKILL_NAMES.has(name);
}

/**
 * L4: создаёт pending proposal из procedural-evidence (детерминированно, без
 * LLM). НЕ активирует скилл и НЕ пишет SKILL.md — только сохраняет pending
 * в `SkillProposalStore` (file-backed). Возвращает `{ id }` или null.
 */
export function createPendingSkillProposal(draft: {
  summary: string;
  reason: string;
  affectedSkillId?: string;
  risk: "low" | "medium";
  content: string;
}): { id: string } | null {
  try {
    const proposal: SkillProposal = {
      id: randomUUID(),
      kind: "new-skill",
      title: draft.summary.slice(0, 80) || "pending proposal",
      content: draft.content,
      status: "pending",
      createdAt: new Date().toISOString(),
      summary: draft.summary,
      reason: draft.reason,
      affectedSkillId: draft.affectedSkillId,
      risk: draft.risk,
    };
    const store = new SkillProposalStore();
    // best-effort durability: fire-and-forget, pending уже в памяти вызова.
    void store.save(proposal);
    return { id: proposal.id };
  } catch {
    return null;
  }
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
const versionStores = new Map<string, SkillVersionStore>();

/** F3: store версионирования на core/SKILL.md (in-memory кэш, base = активный контент). */
function getVersionStore(target: string, baseContent: string): SkillVersionStore {
  let store = versionStores.get(target);
  if (!store) {
    store = new SkillVersionStore({ name: "core", initialContent: baseContent || "# Core\n" });
    versionStores.set(target, store);
  }
  return store;
}

export async function applySkillProposal(
  proposal: SkillProposal,
  skillsRoot: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  if (proposal.kind === "core-edit") {
    const target = path.join(skillsRoot, "core", "SKILL.md");
    const existing = await fs.readFile(target, "utf8").catch(() => "");
    const block = `\n\n## ${proposal.title}\n\n${proposal.content}\n`;
    const nextContent = `${existing.replace(/\s+$/, "")}${block}`;
    if (isAgentRuntimeEnabled(options.env ?? process.env)) {
      // F3 (урок #55647): LLM не перезаписывает production skill —
      // только новая версия рядом, активный SKILL.md не меняется.
      const store = getVersionStore(target, existing);
      const version = store.propose(nextContent, "skill-improver");
      const versionsDir = path.join(skillsRoot, "core", ".versions");
      await fs.mkdir(versionsDir, { recursive: true });
      const versionFile = path.join(versionsDir, `v${version.version}.md`);
      await fs.writeFile(versionFile, nextContent, "utf8");
      return versionFile;
    }
    await fs.writeFile(target, nextContent, "utf8");
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

/** F3: файл-маркер активной версии (core/.versions/active.txt). */
async function readActiveVersion(skillsRoot: string): Promise<number | null> {
  const marker = path.join(skillsRoot, "core", ".versions", "active.txt");
  const raw = await fs.readFile(marker, "utf8").catch(() => "");
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function writeActiveVersion(skillsRoot: string, version: number): Promise<void> {
  const versionsDir = path.join(skillsRoot, "core", ".versions");
  await fs.mkdir(versionsDir, { recursive: true });
  await fs.writeFile(
    path.join(versionsDir, "active.txt"),
    String(version),
    "utf8",
  );
}

/**
 * F3 (§14): активация предложенной версии скилла.
 * Flag on → quality-gate (evaluate) + approveAndActivate, SKILL.md переключается
 * на новый контент; маркер active.txt обновляется. Off → прямое применение
 * (старое поведение). «Хуже-версия не активируется» — через score-порог store.
 */
export async function activateSkillProposal(
  proposal: SkillProposal,
  skillsRoot: string,
  options: { env?: NodeJS.ProcessEnv; qualityScore?: number } = {},
): Promise<string> {
  if (!isAgentRuntimeEnabled(options.env ?? process.env)) {
    return applySkillProposal(proposal, skillsRoot, options);
  }
  if (proposal.kind !== "core-edit") {
    return applySkillProposal(proposal, skillsRoot, options);
  }
  const target = path.join(skillsRoot, "core", "SKILL.md");
  const versionsDir = path.join(skillsRoot, "core", ".versions");
  const entries = await fs.readdir(versionsDir).catch(() => []);
  const candidates = entries
    .filter((f) => /^v\d+\.md$/.test(f))
    .map((f) => Number(f.slice(1, -3)))
    .sort((a, b) => b - a);
  if (candidates.length === 0) {
    throw new Error("no skill versions proposed — nothing to activate");
  }
  const latest = candidates[0];
  const candidateContent = await fs.readFile(
    path.join(versionsDir, `v${latest}.md`),
    "utf8",
  );
  const existing = await fs.readFile(target, "utf8").catch(() => "");
  // Базовая версия (v1) сохраняется при первой активации — точка отката.
  const v1File = path.join(versionsDir, "v1.md");
  const v1Exists = await fs
    .access(v1File)
    .then(() => true)
    .catch(() => false);
  if (!v1Exists) {
    await fs.writeFile(v1File, existing || "# Core\n", "utf8");
  }
  const store = getVersionStore(target, existing || "# Core\n");
  const proposed = store.propose(candidateContent, "skills-approve");
  const score = options.qualityScore ?? 0.5;
  store.evaluate(proposed.version, score, 0.5);
  const result = store.approveAndActivate(proposed.version);
  if (!result.activated) {
    throw new Error(`skill activation failed: ${result.reason}`);
  }
  const activeContent = store.content();
  await fs.writeFile(target, activeContent, "utf8");
  await writeActiveVersion(skillsRoot, proposed.version);
  return target;
}

/** F3 (§14): откат к предыдущей активной версии скилла. */
export async function rollbackSkillVersion(
  skillsRoot: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!isAgentRuntimeEnabled(options.env ?? process.env)) {
    return { ok: false, message: "skill versioning disabled (flag off)" };
  }
  const target = path.join(skillsRoot, "core", "SKILL.md");
  const versionsDir = path.join(skillsRoot, "core", ".versions");
  const active = await readActiveVersion(skillsRoot);
  if (active === null || active <= 1) {
    return { ok: false, message: "no previous version to roll back to" };
  }
  const previous = active - 1;
  const previousFile = path.join(versionsDir, `v${previous}.md`);
  const previousContent = await fs.readFile(previousFile, "utf8").catch(() => "");
  if (!previousContent.trim()) {
    return { ok: false, message: `previous version v${previous} not found` };
  }
  await fs.writeFile(target, previousContent, "utf8");
  await writeActiveVersion(skillsRoot, previous);
  return { ok: true, message: `rolled back to v${previous}` };
}
