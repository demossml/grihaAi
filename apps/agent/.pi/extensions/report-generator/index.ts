import { Type, type Static } from "typebox";
import { Check, Errors } from "typebox/value";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ReportTypeSchema,
  REPORT_SCHEMAS,
} from "../../../src/utils/reports/report-schemas.js";
import { renderPdfReport, renderPresentation } from "../../../src/utils/reports/report-renderer.js";
import { setSessionFile } from "../../../src/utils/telegram/session-files.js";
import { getDocumentsRepository } from "../../../src/services/documents/index.js";
import { buildExpenseReportAttachment } from "../../../src/services/documents/expenseReportTools.js";
import { getUserRulesService } from "../user-rules/UserRulesService.js";
import { getChatSetupService } from "../chat-setup/ChatSetupService.js";
import { getSessionContext } from "../user-rules/context.js";
import { getUsersService } from "../../../src/services/UsersService.js";

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

/** Человекочитаемая подпись Telegram-документа для отчёта. */
function buildReportCaption(reportType: GenerateReportParams["reportType"], data: GenerateReportParams["data"]): string {
  const period = typeof data.period === "string" ? data.period : undefined;
  switch (reportType) {
    case "sales-report":
      return period ? `Отчёт по продажам за ${period}` : "Отчёт по продажам";
    case "expense-report":
      return period ? `Отчёт по расходам за ${period}` : "Отчёт по расходам";
    case "meeting-minutes": {
      const title = typeof data.title === "string" ? data.title : undefined;
      return title ? `Протокол встречи: ${title}` : "Протокол встречи";
    }
  }
}

/** Человекочитаемая подпись Telegram-документа для презентации. */
function buildPresentationCaption(slides: GeneratePresentationParams["slides"]): string {
  const first = slides[0]?.title?.trim();
  return first ? `Презентация: ${first}` : `Презентация (${slides.length} слайдов)`;
}

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
      // R5: expense-report НИКОГДА не рендерится из LLM-данных — данные из БД.
      if (params.reportType === "expense-report") {
        const tctx = getSessionContext(ctx.sessionManager.getSessionId());
        // Период (если LLM его явно передал) резолвится в даты; иначе — весь период.
        const period = typeof params.data.period === "string" ? params.data.period : undefined;
        let fromDate: string | undefined;
        let toDate: string | undefined;
        if (period) {
          try {
            const { resolvePeriod } = await import(
              "../../../src/services/documents/extractors/parsers.js"
            );
            ({ fromDate, toDate } = resolvePeriod(period));
          } catch {
            /* неизвестный period → весь период */
          }
        }
        const built = await buildExpenseReportAttachment(
          { fromDate, toDate },
          {
            chatId: tctx?.chatId,
            userId: tctx?.userId,
            chatTitle: tctx?.chatId
              ? (await getChatSetupService().get(tctx.chatId))?.chatTitle
              : undefined,
            canManage: (userId) => getUsersService().canManage(userId),
          },
          getDocumentsRepository(),
        );
        if ("error" in built) {
          return { content: [{ type: "text", text: built.error }], details: { error: built.error } };
        }
        // R3: hard-rule «только файл» → файл без текста/подписи, dedupeKey гасит дубли.
        const hardRules = tctx?.chatId ? getUserRulesService().getHardRules(tctx.chatId) : [];
        const attachmentOnly = hardRules.some(
          (r) => r.key === "report_attachment_only" && (r.value === true || r.value === "true"),
        );
        setSessionFile(
          ctx.sessionManager.getSessionId(),
          built.filePath,
          attachmentOnly ? undefined : built.caption,
          { attachmentOnly, dedupeKey: built.dedupeKey },
        );
        return {
          content: [{ type: "text", text: attachmentOnly ? "" : `Report generated: ${built.filePath}` }],
          details: { path: built.filePath },
        };
      }

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
        setSessionFile(ctx.sessionManager.getSessionId(), filePath, buildReportCaption(params.reportType, params.data));
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
        setSessionFile(ctx.sessionManager.getSessionId(), filePath, buildPresentationCaption(params.slides));
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
