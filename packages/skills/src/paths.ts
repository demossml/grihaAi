import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the skills content directory shipped with this package.
 * From `dist/paths.js` (or `src/paths.ts` under tsx) this resolves to
 * `packages/skills/skills`.
 */
export function getSkillsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "skills");
}
