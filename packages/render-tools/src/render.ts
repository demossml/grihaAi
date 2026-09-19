import { RenderRequestSchema, type RenderResult } from "@griha/render-contracts";
import { writeOutputAtomically } from "./atomicWrite.js";
import { renderPptxBuffer } from "./pptx.js";
import { getRenderer } from "./templates/registry.js";

/**
 * Единая точка рендера: rawInput → RenderResult. НИКОГДА не бросает наружу.
 *
 *   1. safeParse RenderRequestSchema — fail → INVALID_INPUT
 *   2. getRenderer(template) — missing → UNKNOWN_TEMPLATE
 *   3. renderer → buffer
 *   4. writeOutputAtomically
 *   5. success
 */
export async function renderDocument(rawInput: unknown, opts: { outDir: string }): Promise<RenderResult> {
  const parsed = RenderRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid render request",
      issues: parsed.error.issues.map((i) => i.message),
    };
  }
  const request = parsed.data;
  const started = Date.now();

  if (request.format === "pptx") {
    try {
      const buffer = await renderPptxBuffer(request);
      const filePath = await writeOutputAtomically({
        outDir: opts.outDir,
        prefix: request.template,
        ext: "pptx",
        buffer,
      });
      return { ok: true, filePath, bytes: buffer.length, durationMs: Date.now() - started, warnings: [] };
    } catch (err) {
      return {
        ok: false,
        code: "RENDER_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const renderer = getRenderer(request.template);
  if (!renderer) {
    return { ok: false, code: "UNKNOWN_TEMPLATE", message: `Unknown template: ${request.template}` };
  }

  try {
    const { buffer, warnings, pages } = await renderer(request);
    const filePath = await writeOutputAtomically({
      outDir: opts.outDir,
      prefix: request.template,
      ext: "pdf",
      buffer,
    });
    return { ok: true, filePath, bytes: buffer.length, pages, durationMs: Date.now() - started, warnings };
  } catch (err) {
    return {
      ok: false,
      code: "RENDER_FAILED",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
