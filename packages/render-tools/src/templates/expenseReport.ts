/**
 * expense-report: полная развёртка — шапка, сводка, поставщики, чеки с
 * позициями, итог. Построено на общем layout kit (shell + table).
 */
import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { SpecBuilder, type Spec } from "./spec.js";
import { REPORT_COLORS } from "../layout/tokens.js";
import { buildReportShellSpec } from "../layout/shell.js";
import { addReportTable } from "../layout/table.js";
import type {
  ExpenseLineItem,
  ExpenseReceiptBlock,
  ExpenseReportInput,
  ExpenseSupplierRow,
} from "./expenseReportTypes.js";

function section(b: SpecBuilder, title: string): void {
  b.add("Heading", { text: title, level: "h2", color: REPORT_COLORS.accent });
  b.add("Spacer", { height: 6 });
}

function receiptBlock(b: SpecBuilder, receipt: ExpenseReceiptBlock): void {
  b.add("Text", {
    text: `${receipt.title} — ${receipt.totalLabel}`,
    fontSize: 11,
    fontWeight: "bold",
    color: REPORT_COLORS.accent,
  });
  b.add("Text", { text: receipt.meta, fontSize: 8, color: REPORT_COLORS.muted });
  if (receipt.items.length > 0) {
    addReportTable(b, {
      columns: [
        { header: "Позиция", align: "left", width: "60%" },
        { header: "Кол-во", align: "center", width: "20%" },
        { header: "Сумма", align: "right", width: "20%" },
      ],
      rows: receipt.items.map((i) => [i.name, i.qtyLabel, i.amountLabel]),
      fontSize: 9,
    });
  }
  b.add("Text", {
    text: `Итого чек: ${receipt.totalLabel}`,
    fontSize: 10,
    fontWeight: "bold",
    align: "right",
  });
  b.add("Spacer", { height: 8 });
}

export function buildExpenseReportV2Spec(input: ExpenseReportInput): Spec {
  const currency = input.currency ?? "₽";
  return buildReportShellSpec(
    {
      documentTitle: "Griha · Отчёт по расходам",
      subtitleLines: [
        input.groupTitle ? `Группа: ${input.groupTitle}` : "",
        input.periodLabel ? `Период: ${input.periodLabel}` : "",
        input.generatedAtLabel ? `Сформировано: ${input.generatedAtLabel}` : "",
      ].filter(Boolean),
      footerText: `Валюта: ${currency}`,
    },
    (b) => {
      section(b, "1. Сводка");
      addReportTable(b, {
        columns: [
          { header: "Документы", align: "center", width: "25%" },
          { header: "Поставщики", align: "center", width: "25%" },
          { header: "Позиции", align: "center", width: "25%" },
          { header: "Итого", align: "right", width: "25%" },
        ],
        rows: [
          [
            String(input.summary.documents),
            String(input.summary.suppliers),
            String(input.summary.lineItems),
            input.summary.totalLabel,
          ],
        ],
      });
      b.add("Spacer", { height: 10 });

      section(b, "2. Итоги по поставщикам");
      if (input.suppliers.length > 0) {
        addReportTable(b, {
          columns: [
            { header: "Поставщик", align: "left", width: "50%" },
            { header: "Чеков", align: "center", width: "20%" },
            { header: "Сумма", align: "right", width: "30%" },
          ],
          rows: input.suppliers.map((s: ExpenseSupplierRow) => [
            s.supplier,
            String(s.receiptCount),
            s.totalLabel,
          ]),
        });
      } else {
        b.add("Text", { text: "Нет данных по поставщикам.", fontSize: 10, color: REPORT_COLORS.muted });
      }
      b.add("Spacer", { height: 10 });

      section(b, "3. Развёртка по чекам и позициям");
      if (input.receipts.length > 0) {
        for (const receipt of input.receipts) {
          receiptBlock(b, receipt);
        }
      } else {
        b.add("Text", { text: "Чеков нет.", fontSize: 10, color: REPORT_COLORS.muted });
      }

      b.add("Spacer", { height: 8 });
      b.add("Divider", { color: REPORT_COLORS.border, thickness: 1, marginTop: 4, marginBottom: 4 });
      b.add("Text", {
        text: `Итого: ${input.summary.totalLabel}`,
        fontSize: 14,
        fontWeight: "bold",
        align: "right",
        color: REPORT_COLORS.dark,
      });
    },
  );
}

// ── Legacy: старый ExpenseReportData → ExpenseReportInput ────────────────────

interface LegacyItem {
  date?: string;
  category?: string;
  description?: string;
  amount?: number;
}
interface LegacyCategory {
  name?: string;
  amount?: number;
}

function fmtMoney(n: number, currency: string): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function legacyToInput(data: Record<string, unknown>, currency: string): ExpenseReportInput {
  const period = typeof data.period === "string" ? data.period : "";
  const totalAmount = typeof data.totalAmount === "number" ? data.totalAmount : 0;
  const categories = Array.isArray(data.categories) ? (data.categories as LegacyCategory[]) : [];
  const items = Array.isArray(data.items) ? (data.items as LegacyItem[]) : [];

  const suppliers: ExpenseSupplierRow[] = categories.map((c) => {
    const name = c.name ?? "без категории";
    return {
      supplier: name,
      receiptCount: items.filter((i) => (i.category ?? "без категории") === name).length,
      totalLabel: fmtMoney(c.amount ?? 0, currency),
    };
  });

  const receipts: ExpenseReceiptBlock[] = items.map((it, idx) => ({
    title: `Чек №${idx + 1} · ${it.category ?? "без категории"}`,
    meta: `${it.date ?? ""}${it.description ? ` · ${it.description}` : ""}`,
    totalLabel: fmtMoney(it.amount ?? 0, currency),
    items: [
      {
        name: it.description || it.category || "позиция",
        qtyLabel: "1",
        amountLabel: fmtMoney(it.amount ?? 0, currency),
      } satisfies ExpenseLineItem,
    ],
  }));

  return {
    groupTitle: "",
    periodLabel: period,
    generatedAtLabel: "",
    summary: {
      documents: items.length,
      suppliers: suppliers.length,
      lineItems: items.length,
      totalLabel: fmtMoney(totalAmount, currency),
    },
    suppliers,
    receipts,
    currency,
  };
}

export async function renderExpenseReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const currency = typeof data.currency === "string" && data.currency ? data.currency : "₽";

  // Новый rich-вход (groupTitle/summary/suppliers/receipts) либо legacy fallback.
  const isRich =
    typeof data.groupTitle === "string" ||
    (typeof data.summary === "object" && data.summary !== null) ||
    Array.isArray(data.suppliers) ||
    Array.isArray(data.receipts);

  const input: ExpenseReportInput = isRich
    ? {
        groupTitle: typeof data.groupTitle === "string" ? data.groupTitle : "",
        periodLabel: typeof data.periodLabel === "string" ? data.periodLabel : (typeof data.period === "string" ? data.period : ""),
        generatedAtLabel: typeof data.generatedAtLabel === "string" ? data.generatedAtLabel : "",
        summary: (data.summary as ExpenseReportInput["summary"]) ?? {
          documents: 0,
          suppliers: 0,
          lineItems: 0,
          totalLabel: "0,00 ₽",
        },
        suppliers: Array.isArray(data.suppliers) ? (data.suppliers as ExpenseSupplierRow[]) : [],
        receipts: Array.isArray(data.receipts) ? (data.receipts as ExpenseReceiptBlock[]) : [],
        currency,
      }
    : legacyToInput(data, currency);

  const buffer = await renderPdfBuffer(buildExpenseReportV2Spec(input));
  return { buffer, warnings: [] };
}
