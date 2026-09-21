/**
 * Фасад сервиса отчётов: reader (inject) → DTO. Никакого I/O внутри, кроме
 * вызова reader. LLM не вызывается.
 */
import type {
  ExpenseRow,
  ExpensesReader,
  ProblemsResult,
  ReportDataRequest,
  ReportDataResult,
} from "./types.js";
import { isValidYmd, resolveReportPeriod } from "./resolve-period.js";
import { buildCompactReport } from "./builders/compact.js";
import { buildExpandedReport } from "./builders/expanded.js";
import { toProblemItem } from "./problems.js";

const DEFAULT_LIMIT = 5000;

type LoadError = { error: "MISSING_CHAT_ID" | "INVALID_PERIOD"; message: string };
type LoadOk = {
  chatId: string;
  period: { fromDate: string | null; toDate: string | null; fullHistory: boolean };
  rows: ExpenseRow[];
  groupTitle: string | null;
};

export function createReportDataService(deps: {
  reader: ExpensesReader;
  getGroupTitle?: (chatId: string) => string | undefined | Promise<string | undefined>;
}) {
  async function load(req: {
    chatId: string;
    period?: { fromDate?: string; toDate?: string };
    threadId?: string;
  }): Promise<LoadError | LoadOk> {
    const chatId = (req.chatId ?? "").trim();
    if (!chatId) {
      return { error: "MISSING_CHAT_ID", message: "chatId обязателен" };
    }
    const period = resolveReportPeriod(req.period);
    if (period.fromDate && !isValidYmd(period.fromDate)) {
      return { error: "INVALID_PERIOD", message: "fromDate должен быть YYYY-MM-DD" };
    }
    if (period.toDate && !isValidYmd(period.toDate)) {
      return { error: "INVALID_PERIOD", message: "toDate должен быть YYYY-MM-DD" };
    }
    const rows = await deps.reader.listExpenses({
      chatId,
      threadId: req.threadId,
      fromDate: period.fromDate ?? undefined,
      toDate: period.toDate ?? undefined,
      limit: DEFAULT_LIMIT,
    });
    const title = deps.getGroupTitle ? await deps.getGroupTitle(chatId) : undefined;
    return { chatId, period, rows, groupTitle: title ?? null };
  }

  return {
    async buildExpenseReport(req: ReportDataRequest): Promise<ReportDataResult> {
      try {
        const loaded = await load(req);
        if ("error" in loaded) {
          return { ok: false, code: loaded.error, message: loaded.message };
        }
        if (req.format === "expanded") {
          return { ok: true, report: buildExpandedReport(loaded.rows, loaded) };
        }
        return { ok: true, report: buildCompactReport(loaded.rows, loaded) };
      } catch (e) {
        return {
          ok: false,
          code: "INTERNAL",
          message: e instanceof Error ? e.message : "internal error",
        };
      }
    },

    async listProblemExpenses(req: Omit<ReportDataRequest, "format">): Promise<ProblemsResult> {
      try {
        const loaded = await load(req);
        if ("error" in loaded) {
          return { ok: false, code: loaded.error, message: loaded.message };
        }
        const items = loaded.rows
          .map(toProblemItem)
          .filter((x): x is NonNullable<typeof x> => x != null);
        return {
          ok: true,
          problems: {
            chatId: loaded.chatId,
            groupTitle: loaded.groupTitle,
            period: {
              fromDate: loaded.period.fromDate,
              toDate: loaded.period.toDate,
              fullHistory: loaded.period.fullHistory,
            },
            count: items.length,
            items,
          },
        };
      } catch (e) {
        return {
          ok: false,
          code: "INTERNAL",
          message: e instanceof Error ? e.message : "internal error",
        };
      }
    },
  };
}

export type ReportDataService = ReturnType<typeof createReportDataService>;
