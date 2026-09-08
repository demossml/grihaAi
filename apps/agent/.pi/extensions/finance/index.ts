import path from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";
import {
  ExpenseAddSchema,
  ExpenseListSchema,
  FinanceSummarySchema,
  InvoiceAddSchema,
  InvoiceSetStatusSchema,
  TransactionCategorizeSchema,
  type ExpenseAddParams,
  type ExpenseListParams,
  type FinanceSummaryParams,
  type InvoiceAddParams,
  type InvoiceSetStatusParams,
  type TransactionCategorizeParams,
} from "../../../src/types/index.js";
import {
  categorizeTransaction,
  comparePeriods,
  summarizeExpenses,
} from "../../../src/utils/finance.js";
import { requiresApproval } from "../../../src/utils/approval-policy.js";
import { detectDuplicateInvoices } from "../../../src/utils/anomaly-detect.js";
import { FinanceService } from "./FinanceService.js";
import { AnomalyService } from "../proactive-assistant/AnomalyService.js";
import { getSessionContext } from "../user-rules/context.js";

const FINANCE_DB = path.join(getConfigDir(), "finance.sqlite");
const ANOMALIES_DB = path.join(getConfigDir(), "anomalies.sqlite");

let finance: FinanceService | null = null;
let anomalies: AnomalyService | null = null;

function getFinance(): FinanceService {
  if (!finance) {
    finance = new FinanceService(FINANCE_DB);
    finance.init();
  }
  return finance;
}

function getAnomalies(): AnomalyService {
  if (!anomalies) {
    anomalies = new AnomalyService(ANOMALIES_DB);
    anomalies.init();
  }
  return anomalies;
}

function resolveUserId(ctx: ExtensionContext): string {
  return getSessionContext(ctx.sessionManager.getSessionId())?.userId ?? "owner";
}

export default function financeExtension(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    getFinance();
    getAnomalies();
  });

  pi.on("session_shutdown", () => {
    if (finance) {
      finance.close();
      finance = null;
    }
    if (anomalies) {
      anomalies.close();
      anomalies = null;
    }
  });

  pi.registerTool({
    name: "expense_add",
    label: "Add expense",
    description:
      "Зафиксировать расход (дата, поставщик, сумма, валюта, категория). Сумму/валюту/дату никогда не выдумывай — при неуверенности спроси.",
    parameters: ExpenseAddSchema,
    async execute(
      _toolCallId: string,
      params: ExpenseAddParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string }>> {
      const expense = getFinance().addExpense({ userId: resolveUserId(ctx), ...params });
      return {
        content: [{ type: "text", text: `Expense ${expense.id} recorded.` }],
        details: { id: expense.id },
      };
    },
  });

  pi.registerTool({
    name: "expense_list",
    label: "List expenses",
    description: "Список расходов (опционально по периоду/категории).",
    parameters: ExpenseListSchema,
    async execute(
      _toolCallId: string,
      params: ExpenseListParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ expenses: unknown[] }>> {
      const expenses = getFinance().listExpenses(resolveUserId(ctx), {
        from: params.from,
        to: params.to,
        category: params.category,
      });
      const text =
        expenses.length === 0
          ? "Расходов нет."
          : expenses.map((e) => `- ${e.date} ${e.vendor} ${e.amount} ${e.currency}${e.category ? ` [${e.category}]` : ""}`).join("\n");
      return { content: [{ type: "text", text }], details: { expenses } };
    },
  });

  pi.registerTool({
    name: "transaction_categorize",
    label: "Categorize transaction",
    description:
      "Определить категорию транзакции: сначала история подтверждённых категорий, затем — уточнение у пользователя. Похожие названия не наследуют категорию автоматически.",
    parameters: TransactionCategorizeSchema,
    async execute(
      _toolCallId: string,
      params: TransactionCategorizeParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ category?: string; needsConfirmation: boolean; reason: string }>> {
      const history = getFinance().vendorHistory(resolveUserId(ctx));
      const result = categorizeTransaction(params.vendor, history);
      return {
        content: [
          {
            type: "text",
            text: result.category
              ? `${result.needsConfirmation ? "Предполагаемая" : "Категория"}: ${result.category} (${result.reason})`
              : `Категория неизвестна — спроси пользователя (${result.reason})`,
          },
        ],
        details: {
          category: result.category,
          needsConfirmation: result.needsConfirmation,
          reason: result.reason,
        },
      };
    },
  });

  pi.registerTool({
    name: "invoice_add",
    label: "Add invoice",
    description: "Зафиксировать счёт (номер, сумма, валюта, due date).",
    parameters: InvoiceAddSchema,
    async execute(
      _toolCallId: string,
      params: InvoiceAddParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string }>> {
      const invoice = getFinance().addInvoice({ userId: resolveUserId(ctx), ...params });
      return {
        content: [{ type: "text", text: `Invoice ${invoice.number} (${invoice.id}) created.` }],
        details: { id: invoice.id },
      };
    },
  });

  pi.registerTool({
    name: "invoice_list",
    label: "List invoices",
    description: "Список счетов (статусы обновляются автоматически по due date).",
    parameters: FinanceSummarySchema,
    async execute(
      _toolCallId: string,
      _params: FinanceSummaryParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ invoices: unknown[] }>> {
      getFinance().refreshInvoiceStatuses();
      const invoices = getFinance().listInvoices(resolveUserId(ctx));
      const text =
        invoices.length === 0
          ? "Счетов нет."
          : invoices.map((i) => `- [${i.status}] ${i.number} ${i.amount} ${i.currency}${i.dueDate ? ` (до ${i.dueDate.slice(0, 10)})` : ""}`).join("\n");
      return { content: [{ type: "text", text }], details: { invoices } };
    },
  });

  pi.registerTool({
    name: "invoice_set_status",
    label: "Set invoice status",
    description:
      "Изменить статус счёта. Статус paid — финансовое действие и требует approval policy.",
    parameters: InvoiceSetStatusSchema,
    async execute(
      _toolCallId: string,
      params: InvoiceSetStatusParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ updated: boolean; approvalRequired?: boolean }>> {
      const invoice = getFinance().getInvoice(params.id);
      if (!invoice) {
        return { content: [{ type: "text", text: "Invoice not found." }], details: { updated: false } };
      }

      // Financial mutation: "paid" goes through the approval policy first.
      if (params.status === "paid") {
        const decision = requiresApproval("invoice.pay", { amount: invoice.amount, currency: invoice.currency });
        if (decision.required) {
          return {
            content: [
              {
                type: "text",
                text: `Смена статуса на paid требует подтверждения (${decision.reason}). Вызови approval_required с action="invoice.pay" и arguments={amount, currency}.`,
              },
            ],
            details: { updated: false, approvalRequired: true },
          };
        }
      }

      const updated = getFinance().setInvoiceStatus(params.id, params.status);
      return {
        content: [{ type: "text", text: updated ? `Invoice ${params.status}.` : "Invoice not found." }],
        details: { updated: Boolean(updated) },
      };
    },
  });

  pi.registerTool({
    name: "finance_summary",
    label: "Finance summary",
    description:
      "Детерминированная агрегация расходов: total, по категориям, по поставщикам, сравнение с прошлым периодом.",
    parameters: FinanceSummarySchema,
    async execute(
      _toolCallId: string,
      params: FinanceSummaryParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ summary: unknown; comparison?: unknown }>> {
      const userId = resolveUserId(ctx);
      const service = getFinance();

      // Scan for invoice anomalies on demand (duplicates + overdue).
      const invoices = service.listInvoices(userId);
      getAnomalies().record(
        detectDuplicateInvoices(
          invoices.map((i) => ({ id: i.id, vendor: i.vendor, amount: i.amount, currency: i.currency, date: i.dueDate })),
        ),
      );
      const overdue = invoices
        .filter((i) => i.status === "overdue")
        .map((i) => ({
          userId,
          type: "invoice_overdue",
          severity: "critical" as const,
          explanation: `Счёт просрочен: ${i.number} ${i.amount} ${i.currency}`,
          evidence: { invoiceId: i.id },
        }));
      getAnomalies().record(overdue);

      const expenses = service.listExpenses(userId, { from: params.from, to: params.to });
      const summary = summarizeExpenses(expenses);

      // Comparison with the previous period of equal length.
      let comparison;
      if (params.from && params.to) {
        const from = new Date(params.from).getTime();
        const to = new Date(params.to).getTime();
        if (Number.isFinite(from) && Number.isFinite(to)) {
          const length = to - from;
          const prevFrom = new Date(from - length).toISOString();
          const prevTo = new Date(to - length).toISOString();
          const previous = summarizeExpenses(service.listExpenses(userId, { from: prevFrom, to: prevTo }));
          comparison = comparePeriods(summary.total, previous.total);
        }
      }

      const text = `Всего: ${summary.total}\n${Object.entries(summary.byCategory)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")}`;
      return {
        content: [{ type: "text", text }],
        details: { summary, comparison },
      };
    },
  });
}
