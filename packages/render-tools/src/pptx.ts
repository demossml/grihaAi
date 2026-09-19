import type { RenderRequest } from "@griha/render-contracts";

/**
 * PPTX в agent-е — отдельный путь (renderPresentation), здесь пока не
 * реализован. renderDocument отдаёт RENDER_FAILED "pptx not implemented".
 */
export async function renderPptxBuffer(_request: RenderRequest): Promise<Buffer> {
  throw new Error("pptx not implemented");
}
