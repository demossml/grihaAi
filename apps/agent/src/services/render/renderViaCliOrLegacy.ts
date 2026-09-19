import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { RenderRequest } from "@griha/render-contracts";
import { REPORTS_DIR } from "../../utils/reports/report-renderer.js";
import { createRenderCliClient } from "./renderCliClient.js";

/**
 * Точка ветвления рендера отчёта: CLI (spawn) по флагу, иначе legacy 1:1.
 * Без GRIHA_RENDER_CLI=1 поведение НЕ меняется.
 */

function resolveCliPath(): string {
  const explicit = process.env.GRIHA_RENDER_CLI_PATH;
  if (explicit) return explicit;
  const candidates = [
    // cwd = apps/agent
    path.resolve(process.cwd(), "../render-cli/dist/bin.js"),
    // cwd = корень монорепо
    path.resolve(process.cwd(), "apps/render-cli/dist/bin.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export async function renderViaCliOrLegacy(
  request: RenderRequest,
  legacyRender: () => Promise<string>,
): Promise<{ filePath: string; via: "cli" | "legacy" }> {
  if (process.env.GRIHA_RENDER_CLI !== "1") {
    return { filePath: await legacyRender(), via: "legacy" };
  }

  const cliPath = resolveCliPath();
  const timeoutMs = Number(process.env.GRIHA_RENDER_CLI_TIMEOUT_MS ?? 60_000);
  mkdirSync(REPORTS_DIR, { recursive: true });

  const client = createRenderCliClient({ cliPath, outDir: REPORTS_DIR, timeoutMs });
  const result = await client.render(request);

  if (!result.ok) {
    console.error("[render] CLI failed, fallback legacy:", result.code, result.message);
    return { filePath: await legacyRender(), via: "legacy" };
  }
  return { filePath: result.filePath, via: "cli" };
}
