/**
 * Minimal line-based frontmatter parser (no pi dependency).
 *
 * Parses the `--- ... ---` YAML-ish block for the keys the skills runtime
 * needs: name, description, version, tags, autoCreated. Supports:
 *   - `key: value`
 *   - `tags: [a, b]` (flow array)
 *   - `tags:` followed by indented `- item` lines (block list)
 */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  tags?: string[] | string;
  autoCreated?: boolean;
  [key: string]: unknown;
}

function parseTags(raw: string): string[] | string {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    return t
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return t;
}

export function parseFrontmatter(raw: string): SkillFrontmatter {
  const fm: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return fm;

  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    if (value === "") {
      // block list continuation (`tags:` then `  - item`)
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s?/.test(lines[i + 1])) {
        i++;
        items.push(lines[i].replace(/^\s+-\s?/, "").trim());
      }
      if (items.length > 0) {
        fm[key] = items;
        continue;
      }
    }

    if (key === "tags") {
      fm[key] = parseTags(value);
    } else if (key === "autoCreated") {
      fm[key] = value === "true" || value === "1" || value.toLowerCase() === "yes";
    } else {
      fm[key] = value;
    }
  }

  return fm;
}
