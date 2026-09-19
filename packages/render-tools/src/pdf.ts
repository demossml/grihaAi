import { ensureReportFonts } from "./fonts.js";
import type { Spec } from "./templates/spec.js";

/**
 * Рендер spec → PDF-буфер через @json-render/react-pdf (внутри @react-pdf/renderer).
 * Перенесено из apps/agent defaultPdfRender (было renderToFile → здесь renderToBuffer).
 */
export async function renderPdfBuffer(spec: Spec): Promise<Buffer> {
  const [{ renderToBuffer }, { Font }] = await Promise.all([
    import("@json-render/react-pdf"),
    import("@react-pdf/renderer"),
  ]);
  ensureReportFonts(Font);
  const result = await renderToBuffer(spec as unknown as Parameters<typeof renderToBuffer>[0]);
  return Buffer.isBuffer(result) ? result : Buffer.from(result as Uint8Array);
}
