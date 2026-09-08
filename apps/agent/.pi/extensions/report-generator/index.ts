import { Type, type Static } from "typebox";
import { Check, Errors } from "typebox/value";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ReportTypeSchema,
  REPORT_SCHEMAS,
} from "../../../src/utils/report-schemas.js";
import { renderPdfReport, renderPresentation } from "../../../src/utils/report-renderer.js";
import { setSessionFile } from "../../../src/utils/session-files.js";

/**
 * Deterministic document generation.
 *
 * `generate_report` / `generate_presentation` render FIXED templates only —
 * the LLM supplies data, not layout. There is deliberately no "style"/"layout"
 * parameter so every report looks the same.
 */

const GenerateReportSchema = Type.Object({
  reportType: ReportTypeSchema,
  data: Type.Record(Type.String(), Type.Unknown()),
});
type GenerateReportParams = Static<typeof GenerateReportSchema>;

const GeneratePresentationSchema = Type.Object({
  slides: Type.Array(
    Type.Object({
      title: Type.String({ minLength: 1 }),
      bullets: Type.Array(Type.String()),
    }),
  ),
});
type GeneratePresentationParams = Static<typeof GeneratePresentationSchema>;

export default function reportGenerator(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "generate_report",
    label: "Generate report",
    description:
      "Сгенерировать PDF-отчёт по фиксированному шаблону (sales-report | expense-report | meeting-minutes).",
    parameters: GenerateReportSchema,
    async execute(
      _toolCallId: string,
      params: GenerateReportParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ path?: string; error?: string }>> {
      const schema = REPORT_SCHEMAS[params.reportType];
      if (!Check(schema, params.data)) {
        const errors = Errors(schema, params.data).map((e) => e.message).join("; ");
        return {
          content: [{ type: "text", text: `Invalid report data: ${errors}` }],
          details: { error: errors },
        };
      }

      try {
        const filePath = await renderPdfReport(params.reportType, params.data);
        // Register the file for the session so the Telegram layer can attach it
        // to the reply as a document (same per-session form as file_id handling).
        setSessionFile(ctx.sessionManager.getSessionId(), filePath);
        return {
          content: [{ type: "text", text: `Report generated: ${filePath}` }],
          details: { path: filePath },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Report generation failed: ${message}` }],
          details: { error: message },
        };
      }
    },
  });

  pi.registerTool({
    name: "generate_presentation",
    label: "Generate presentation",
    description:
      "Сгенерировать PPTX-презентацию по фиксированному слайд-мастеру (массив {title, bullets[]}).",
    parameters: GeneratePresentationSchema,
    async execute(
      _toolCallId: string,
      params: GeneratePresentationParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ path?: string; error?: string }>> {
      try {
        const filePath = await renderPresentation(params.slides);
        // Register the file for the session so the Telegram layer can attach it
        // to the reply as a document.
        setSessionFile(ctx.sessionManager.getSessionId(), filePath);
        return {
          content: [{ type: "text", text: `Presentation generated: ${filePath}` }],
          details: { path: filePath },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Presentation generation failed: ${message}` }],
          details: { error: message },
        };
      }
    },
  });
}
