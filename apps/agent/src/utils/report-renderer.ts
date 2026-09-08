import Handlebars from "handlebars";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { ReportType } from "./report-schemas.js";

/**
 * Deterministic document generation from FIXED templates.
 *
 * The LLM only fills data into a pre-built layout — it cannot change the
 * template, so figures land in the same place in every report. Handlebars is
 * the template engine; Playwright (headless Chromium) renders HTML→PDF for
 * pixel-accurate output — a deliberate heavy dependency (see ARCHITECTURE.md).
 */

const DEFAULT_TEMPLATES_DIR = fileURLToPath(
  new URL("../../.pi/extensions/report-generator/templates/", import.meta.url),
);

/** Output directory for generated files. */
export const REPORTS_DIR = path.join(homedir(), ".grish-ai", "reports");

export interface PresentationSlide {
  title: string;
  bullets: string[];
}

export interface ReportRendererOptions {
  /** Override the templates directory (tests). */
  templatesDir?: string;
  /** Override the output directory (tests). */
  outputDir?: string;
  /** Inject the HTML→PDF step (tests). Defaults to Playwright headless Chromium. */
  pdfRenderFn?: (html: string, outputPath: string) => Promise<void>;
  /** Inject the PPTX write step (tests). Defaults to pptxgenjs. */
  pptxWriteFn?: (slides: PresentationSlide[], outputPath: string) => Promise<void>;
}

/**
 * Compile a template with Handlebars and substitute the data. Pure-ish and
 * fast — unit-tested with real templates, no browser/network involved.
 */
export async function renderHtml(
  templateName: string,
  data: Record<string, unknown>,
  options: ReportRendererOptions = {},
): Promise<string> {
  const dir = options.templatesDir ?? DEFAULT_TEMPLATES_DIR;
  const source = await fs.readFile(path.join(dir, `${templateName}.html`), "utf8");
  return Handlebars.compile(source)(data);
}

async function ensureOutputDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Render a fixed-template report to a PDF file and return its path. */
export async function renderPdfReport(
  type: ReportType,
  data: Record<string, unknown>,
  options: ReportRendererOptions = {},
): Promise<string> {
  const html = await renderHtml(type, data, options);
  const dir = options.outputDir ?? REPORTS_DIR;
  await ensureOutputDir(dir);
  const outputPath = path.join(dir, `${randomUUID()}.pdf`);
  const pdfRender = options.pdfRenderFn ?? defaultPdfRender;
  await pdfRender(html, outputPath);
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
 * Playwright headless Chromium — lazy-imported so unit tests never load the
 * browser. Requires `npx playwright install chromium` once at deploy time.
 */
async function defaultPdfRender(html: string, outputPath: string): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
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
