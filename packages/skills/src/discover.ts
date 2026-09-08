import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./parse.js";
import { getSkillsRoot } from "./paths.js";
import type { SkillMeta } from "./types.js";

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
  const frontmatter = parseFrontmatter(raw);

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
 * Recursively discover agentskills.io skills under `rootDir` (default:
 * the package's own `skills/` directory).
 *
 * Discovery rules:
 * - a directory containing SKILL.md is a skill root and is not recursed further;
 * - otherwise, direct .md children in the directory are treated as skills;
 * - subdirectories are recursed to find SKILL.md.
 */
export async function discoverSkills(rootDir?: string): Promise<SkillMeta[]> {
  const root = rootDir ?? getSkillsRoot();
  const skills: SkillMeta[] = [];
  const stack: string[] = [root];

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
