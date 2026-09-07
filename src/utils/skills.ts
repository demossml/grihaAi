import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { SkillMeta } from "../types/index.js";

interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string | number;
  tags?: string[] | string;
  autoCreated?: boolean;
  [key: string]: unknown;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function normalizeTags(value: string[] | string | undefined): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value.map((t) => String(t).trim()).filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  if (typeof value === "string") {
    const tags = value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  return undefined;
}

async function parseSkillFile(filePath: string, baseDir: string): Promise<SkillMeta> {
  const raw = await fs.readFile(filePath, "utf8");
  const { frontmatter } = parseFrontmatter<SkillFrontmatter>(raw);

  const isSkillMd = path.basename(filePath).toLowerCase() === "skill.md";
  const fallbackName = isSkillMd
    ? path.basename(path.dirname(filePath))
    : path.basename(filePath, path.extname(filePath));

  const name = (frontmatter.name?.trim() || fallbackName).trim();
  const description = frontmatter.description?.trim() ?? "";

  return {
    name,
    description,
    path: path.resolve(baseDir, path.basename(filePath)),
    version: frontmatter.version != null ? String(frontmatter.version) : undefined,
    tags: normalizeTags(frontmatter.tags),
    autoCreated: frontmatter.autoCreated === true ? true : undefined,
  };
}

/**
 * Recursively discover agentskills.io skills under `rootDir`.
 *
 * Discovery rules (mirrors pi/agentskills.io):
 * - a directory containing SKILL.md is a skill root and is not recursed further;
 * - otherwise, direct .md children in the directory are treated as skills;
 * - subdirectories are recursed to find SKILL.md.
 */
export async function discoverSkills(rootDir: string): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const skillMd = path.join(dir, "SKILL.md");
    if (await pathExists(skillMd)) {
      skills.push(await parseSkillFile(skillMd, dir));
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(".md")) {
        skills.push(await parseSkillFile(full, dir));
      }
    }
  }

  return skills;
}

/** Format a list of skills for inclusion in a system prompt. */
export function formatSkillsForPrompt(skills: SkillMeta[]): string {
  if (skills.length === 0) return "No skills available.";
  return skills
    .map((s) => {
      const flags: string[] = [];
      if (s.autoCreated) flags.push("autoCreated");
      if (s.version) flags.push(`v${s.version}`);
      const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
      const desc = s.description.trim() ? s.description.trim() : "(no description)";
      return `- ${s.name}${suffix}: ${desc}`;
    })
    .join("\n");
}
