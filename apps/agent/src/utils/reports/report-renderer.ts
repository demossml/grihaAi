import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { ReportType } from "./report-schemas.js";
import { buildReportSpec, type ReportSpec } from "./report-specs.js";

/**
 * Deterministic document generation from FIXED json-render specs.
 *
 * The LLM only fills data into a pre-built spec — it cannot change the layout,
 * so figures land in the same place in every report. The spec uses only the
 * standard @json-render/react-pdf component catalog (Document, Page, Heading,
 * Text, Table, List, Divider, Spacer); rendering happens in pure Node via
 * @react-pdf/renderer — no headless browser.
 */

/** Output directory for generated files. */
export const REPORTS_DIR = path.join(homedir(), ".grish-ai", "reports");

export interface PresentationSlide {
  title: string;
  bullets: string[];
}

export interface ReportRendererOptions {
  /** Override the output directory (tests). */
  outputDir?: string;
  /** Inject the spec→PDF step (tests). Defaults to @json-render/react-pdf renderToFile. */
  pdfSpecRenderFn?: (spec: ReportSpec, outputPath: string) => Promise<void>;
  /** Inject the PPTX write step (tests). Defaults to pptxgenjs. */
  pptxWriteFn?: (slides: PresentationSlide[], outputPath: string) => Promise<void>;
}

async function ensureOutputDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Render a fixed-spec report to a PDF file and return its path. */
export async function renderPdfReport(
  type: ReportType,
  data: Record<string, unknown>,
  options: ReportRendererOptions = {},
): Promise<string> {
  const spec = buildReportSpec(type, data);
  const dir = options.outputDir ?? REPORTS_DIR;
  await ensureOutputDir(dir);
  const outputPath = path.join(dir, `${randomUUID()}.pdf`);
  const pdfRender = options.pdfSpecRenderFn ?? defaultPdfRender;
  await pdfRender(spec, outputPath);
  return outputPath;
}

/** Render a fixed slide-master presentation to a PPTX file and return its path. */
export async function renderPresentation(
  slides: PresentationSlide[],
  options: ReportRendererOptions = {},
): Promise<string> {
  const dir = options.outputDir ?? REPORTS_DIR;
  await ensureOutputDir(dir);
  const outputPath = path.join(dir, `${randomUUID()}.pptx`);
  const pptxWrite = options.pptxWriteFn ?? defaultPptxWrite;
  await pptxWrite(slides, outputPath);
  return outputPath;
}

/**
 * @json-render/react-pdf — lazy-imported so unit tests never load
 * @react-pdf/renderer. Pure Node rendering (no browser), safe for plain CI.
 */
async function defaultPdfRender(spec: ReportSpec, outputPath: string): Promise<void> {
  const { renderToFile } = await import("@json-render/react-pdf");
  // The spec is structural; the library types are catalog-generic.
  await renderToFile(spec as unknown as Parameters<typeof renderToFile>[0], outputPath);
}

/**
 * pptxgenjs — one fixed slide master: title + bullets, uniform font/colors.
 * The LLM supplies only `{ title, bullets[] }` per slide, no free-form layout.
 */
async function defaultPptxWrite(
  slides: PresentationSlide[],
  outputPath: string,
): Promise<void> {
  interface PptxSlideLike {
    addText(
      text: string | Array<{ text: string; options: { bullet: boolean } }>,
      options: Record<string, unknown>,
    ): unknown;
  }
  interface PptxGenLike {
    addSlide(): PptxSlideLike;
    writeFile(props: { fileName: string }): Promise<string>;
  }

  // pptxgenjs's default export is a class; cast through a structural type so
  // the dynamic import typechecks without coupling to the package's exact types.
  const PptxGenJS = (await import("pptxgenjs")).default as unknown as new () => PptxGenLike;
  const pptx = new PptxGenJS();
  for (const slideData of slides) {
    const slide = pptx.addSlide();
    slide.addText(slideData.title, {
      x: 0.5,
      y: 0.4,
      w: 9,
      h: 0.9,
      fontSize: 24,
      bold: true,
      color: "1F3864",
      fontFace: "Calibri",
    });
    slide.addText(
      slideData.bullets.map((text) => ({ text, options: { bullet: true } })),
      {
        x: 0.6,
        y: 1.5,
        w: 8.8,
        h: 5.2,
        fontSize: 16,
        color: "333333",
        fontFace: "Calibri",
        valign: "top",
      },
    );
  }
  await pptx.writeFile({ fileName: outputPath });
}
