import { Type, type Static } from "typebox";
import { Check, Errors } from "typebox/value";
import { statSync } from "node:fs";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ReportTypeSchema,
  REPORT_SCHEMAS,
  hasExpenseReportData,
  type ExpenseReportData,
} from "../../../src/utils/reports/report-schemas.js";
import { renderPdfReport, renderPresentation } from "../../../src/utils/reports/report-renderer.js";
import { renderViaCliOrLegacy } from "../../../src/services/render/renderViaCliOrLegacy.js";
import type { RenderRequest } from "@griha/render-contracts";
import { setSessionFile } from "../../../src/utils/telegram/session-files.js";
import { getSessionContext } from "../user-rules/context.js";
import { logTelegramEvent } from "../telegram-bot/telegram-diagnostics.js";
import { emit } from "@griha/observability";
import { getDocumentsRepository } from "../../../src/services/documents/index.js";
import { getChatSetupService } from "../chat-setup/ChatSetupService.js";
import {
  buildExpenseReportInput,
  EXPENSE_REPORT_EMPTY_MESSAGE,
} from "../../../src/services/documents/expenseReportTools.js";
import type { DocumentsRepository } from "../../../src/services/documents/DocumentsRepository.js";

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
  const period =
    typeof data.periodLabel === "string"
      ? data.periodLabel
      : typeof data.period === "string"
        ? data.period
        : undefined;
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

export default function reportGenerator(
  pi: ExtensionAPI,
  deps?: { documentsRepo?: DocumentsRepository },
): void {
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

      // E2/E3: данные для PDF-отчёта. Если LLM передал пустой объект — данные
      // подтягиваются из БД по чату сессии (канонический источник, тот же, что
      // у текстового эталона expenses_sum). Пусто в БД — явная ошибка, файл не
      // создаётся и не регистрируется.
      let renderData: Record<string, unknown> = params.data;
      if (params.reportType === "expense-report") {
        const expenseData = params.data as ExpenseReportData;
        const sessionCtx = getSessionContext(ctx.sessionManager.getSessionId());
        // Правда сумм — из БД, а не из придуманных LLM totals. При наличии scope
        // чата пересчитываем totalAmount/categories/items из БД (период — от LLM).
        if (sessionCtx?.chatId) {
          const repo = deps?.documentsRepo ?? getDocumentsRepository();
          // R6: rich-вход ExpenseReportInput (group title + поставщики + чеки с
          // позициями) — тот же тип, что рисует @griha/render-tools.
          const built = await buildExpenseReportInput(
            repo,
            {
              chatId: sessionCtx.chatId,
              threadId: sessionCtx.threadId,
              period: typeof expenseData.period === "string" ? expenseData.period : undefined,
            },
            { getChatTitle: (chatId) => getChatSetupService().getChatTitleSync(chatId) },
          );
          if (built.ok) {
            renderData = built.data as unknown as Record<string, unknown>;
          } else if (!hasExpenseReportData(expenseData)) {
            // БД пуста И LLM не дал валидных данных — явная ошибка.
            return {
              content: [{ type: "text", text: built.error }],
              details: { error: "EXPENSE_REPORT_EMPTY: no rows and no total" },
            };
          }
          // БД пуста, но LLM дал валидные данные (ручной отчёт) — оставляем их.
        } else if (!hasExpenseReportData(expenseData)) {
          // Без чата сессии наполнять не из чего — ошибка без открытия БД.
          return {
            content: [{ type: "text", text: EXPENSE_REPORT_EMPTY_MESSAGE }],
            details: { error: "EXPENSE_REPORT_EMPTY: no rows and no total" },
          };
        }
      }

      const sessionCtx = getSessionContext(ctx.sessionManager.getSessionId());
      const correlationId = sessionCtx?.correlationId;
      logTelegramEvent({
        event: "document.validated",
        correlationId,
        chatId: sessionCtx?.chatId,
        sessionId: ctx.sessionManager.getSessionId(),
        status: "ok",
        artifactId: `report:${params.reportType}`,
      });

      try {
        const caption = buildReportCaption(params.reportType, renderData);
        const request: RenderRequest = {
          format: "pdf",
          template: params.reportType,
          title: caption,
          locale: "ru",
          blocks: [{ kind: "markdown", text: caption }],
          data: renderData,
        };
        emit({
          component: "report.render",
          event: "report.render.start",
          chatId: sessionCtx?.chatId,
          data: { reportType: params.reportType },
        });
        const startedAt = Date.now();
        // P5: ветвление рендера. Без GRIHA_RENDER_CLI=1 → legacy (renderPdfReport) 1:1.
        const { filePath } = await renderViaCliOrLegacy(request, () =>
          renderPdfReport(params.reportType, renderData),
        );
        const bytes = statSync(filePath).size;
        emit({
          component: "report.render",
          event: "report.render.end",
          ok: true,
          chatId: sessionCtx?.chatId,
          durationMs: Date.now() - startedAt,
          data: { reportType: params.reportType, bytes },
        });
        logTelegramEvent({
          event: "document.created",
          correlationId,
          chatId: sessionCtx?.chatId,
          sessionId: ctx.sessionManager.getSessionId(),
          status: "ok",
          fileSize: statSync(filePath).size,
          artifactId: `report:${params.reportType}`,
        });
        // Register the file for the session so the Telegram layer can attach it
        // to the reply as a document (same per-session form as file_id handling).
        // E4: dedupeKey подавляет повторную отправку того же отчёта (send_file
        // и второй generate_report за ход).
        setSessionFile(ctx.sessionManager.getSessionId(), filePath, caption, {
          dedupeKey: `report:${params.reportType}`,
        });
        return {
          content: [{ type: "text", text: `Report generated: ${filePath}` }],
          details: { path: filePath },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({
          component: "report.render",
          event: "report.render.end",
          ok: false,
          chatId: sessionCtx?.chatId,
          data: { reportType: params.reportType, error: message },
        });
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
