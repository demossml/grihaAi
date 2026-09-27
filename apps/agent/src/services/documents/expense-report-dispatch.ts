/**
 * Детерминированный dispatch expense-PDF: БД → render → filePath.
 *
 * Без LLM внутри: данные только из `buildExpenseReportData` (БД), рендер — через
 * существующий report-renderer. Никогда не возвращает ok:true без реально
 * существующего файла (`assertSendablePdf`).
 */
import { statSync, existsSync } from "node:fs";
import { emit } from "@griha/observability";
import type { RenderRequest } from "@griha/render-contracts";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import { buildExpenseReportData, EXPENSE_REPORT_EMPTY_MESSAGE } from "./expenseReportTools.js";
import { renderPdfReport } from "../../utils/reports/report-renderer.js";
import { renderViaCliOrLegacy } from "../render/renderViaCliOrLegacy.js";
import { withTimeout, TimeoutError } from "../../runtime/util/with-timeout.js";

export interface ReportDispatchInput {
  chatId: string;
  threadId?: string;
  userId?: string;
  /** ISO YYYY-MM-DD, если парсится из текста; иначе весь период. */
  fromDate?: string;
  toDate?: string;
  periodLabel?: string;
}

export type ReportDispatchCode =
  | "EMPTY"
  | "BUILD_FAILED"
  | "RENDER_FAILED"
  | "WRITE_FAILED"
  | "ACCESS_DENIED";

export type ReportDispatchResult =
  | {
      ok: true;
      filePath: string;
      bytes: number;
      periodLabel: string;
      totalAmount: number;
      docCount: number;
    }
  | {
      ok: false;
      code: ReportDispatchCode;
      message: string; // коротко, для пользователя, без stack
    };

export interface ReportDispatchDeps {
  repo: DocumentsRepository;
  /** ACL для кросс-чата (текущий чат уже прошёл prefilter). */
  canRead?: (userId: string | undefined, chatId: string) => Promise<boolean>;
  /** Рендер data → PDF path (инъекция для тестов). */
  renderPdf?: (data: Record<string, unknown>) => Promise<string>;
}

/** Таймаут рендера PDF в dispatch-пути (не ждём глобальный watchdog 300s). */
const PDF_RENDER_TIMEOUT_MS = 60_000;

const PDF_TIMEOUT_MESSAGE = "Не удалось собрать PDF за отведённое время. Попробуйте ещё раз.";

/** Проверка файла перед отправкой: путь задан, существует, не пустой. */
export function assertSendablePdf(filePath: string): void {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("PDF_PATH_MISSING");
  }
  if (!existsSync(filePath)) {
    throw new Error(`PDF_PATH_NOT_FOUND:${filePath}`);
  }
  const st = statSync(filePath);
  if (st.size < 1000) {
    throw new Error(`PDF_TOO_SMALL:${st.size}`);
  }
}

function defaultRender(periodLabel: string): (data: Record<string, unknown>) => Promise<string> {
  return async (data) => {
    const caption = `Отчёт по расходам за ${periodLabel}`;
    const request: RenderRequest = {
      format: "pdf",
      template: "expense-report",
      title: caption,
      locale: "ru",
      blocks: [{ kind: "markdown", text: caption }],
      data,
    };
    const { filePath } = await renderViaCliOrLegacy(request, () =>
      renderPdfReport("expense-report", data),
    );
    return filePath;
  };
}

/**
 * 1) ACL (если задан) 2) buildExpenseReportData (БД) 3) render PDF 4) validate
 * (existsSync + size) 5) вернуть filePath. Ошибки — короткий код, без stack.
 */
export async function runExpenseReportDispatch(
  input: ReportDispatchInput,
  deps: ReportDispatchDeps,
): Promise<ReportDispatchResult> {
  if (deps.canRead) {
    const allowed = await deps.canRead(input.userId, input.chatId);
    if (!allowed) {
      return { ok: false, code: "ACCESS_DENIED", message: "Нет доступа к этому чату." };
    }
  }

  // 2) Данные строго из БД (канонический источник сумм/категорий).
  emit({
    component: "report",
    event: "report.build_data",
    chatId: input.chatId,
    data: { phase: "start" },
  });
  const buildStartedAt = Date.now();
  let built;
  try {
    built = await buildExpenseReportData(deps.repo, {
      chatId: input.chatId,
      threadId: input.threadId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      period: input.periodLabel,
    });
  } catch {
    emit({
      component: "report",
      event: "report.build_data",
      ok: false,
      chatId: input.chatId,
      durationMs: Date.now() - buildStartedAt,
      data: { phase: "end", code: "BUILD_FAILED" },
    });
    return { ok: false, code: "BUILD_FAILED", message: "Не удалось собрать данные отчёта." };
  }
  if (!built.ok) {
    emit({
      component: "report",
      event: "report.build_data",
      ok: false,
      chatId: input.chatId,
      durationMs: Date.now() - buildStartedAt,
      data: { phase: "end", code: "EMPTY" },
    });
    const msg = built.error === EXPENSE_REPORT_EMPTY_MESSAGE ? "Нет данных для отчёта." : built.error;
    return { ok: false, code: "EMPTY", message: msg };
  }
  emit({
    component: "report",
    event: "report.build_data",
    ok: true,
    chatId: input.chatId,
    durationMs: Date.now() - buildStartedAt,
    data: {
      phase: "end",
      code: "OK",
      docCount: built.data.items.length,
      needsReviewCount: built.data.needsReviewCount,
      totalAmount: built.data.totalAmount,
    },
  });

  const renderData = built.data as unknown as Record<string, unknown>;
  const render = deps.renderPdf ?? defaultRender(built.periodLabel);

  // 3) Рендер с таймаутом.
  emit({
    component: "report",
    event: "report.render_pdf",
    chatId: input.chatId,
    data: { phase: "start" },
  });
  const renderStartedAt = Date.now();
  let filePath: string;
  try {
    filePath = await withTimeout("report_dispatch_render", PDF_RENDER_TIMEOUT_MS, () =>
      render(renderData),
    );
  } catch (err) {
    const timedOut = err instanceof TimeoutError;
    emit({
      component: "report",
      event: "report.render_pdf",
      ok: false,
      chatId: input.chatId,
      durationMs: Date.now() - renderStartedAt,
      data: { phase: "end", code: timedOut ? "TIMEOUT_PDF" : "RENDER_FAILED" },
    });
    emit({
      component: "report",
      event: "report.pdf.fail",
      ok: false,
      chatId: input.chatId,
      data: { code: timedOut ? "TIMEOUT_PDF" : "RENDER_FAILED" },
    });
    return {
      ok: false,
      code: "RENDER_FAILED",
      message: timedOut ? PDF_TIMEOUT_MESSAGE : "Не удалось собрать PDF. Попробуйте ещё раз.",
    };
  }

  // 4) Валидация файла перед возвратом.
  try {
    assertSendablePdf(filePath);
  } catch {
    emit({
      component: "report",
      event: "report.render_pdf",
      ok: false,
      chatId: input.chatId,
      durationMs: Date.now() - renderStartedAt,
      data: { phase: "end", code: "PATH_NOT_FOUND", pdfPathExists: false },
    });
    emit({
      component: "report",
      event: "report.pdf.fail",
      ok: false,
      chatId: input.chatId,
      data: { code: "WRITE_FAILED" },
    });
    return { ok: false, code: "WRITE_FAILED", message: "PDF не сформировался. Попробуйте ещё раз." };
  }

  const bytes = statSync(filePath).size;
  emit({
    component: "report",
    event: "report.render_pdf",
    ok: true,
    chatId: input.chatId,
    durationMs: Date.now() - renderStartedAt,
    data: {
      phase: "end",
      code: "OK",
      pdfBytes: bytes,
      pdfPathExists: true,
      pdfBasename: filePath.split(/[\\/]/).pop(),
    },
  });
  emit({
    component: "report",
    event: "report.pdf.ok",
    ok: true,
    chatId: input.chatId,
    data: { bytes, totalAmount: built.data.totalAmount, docCount: built.data.items.length },
  });

  return {
    ok: true,
    filePath,
    bytes,
    periodLabel: built.periodLabel,
    totalAmount: built.data.totalAmount,
    docCount: built.data.items.length,
  };
}
