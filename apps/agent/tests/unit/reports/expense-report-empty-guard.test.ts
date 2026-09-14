/**
 * E2: запрет «успешного» пустого PDF.
 *
 * - пустые данные (нет строк и нет ненулевого итога) → tool error,
 *   файл НЕ создаётся, session-file НЕ регистрируется;
 * - данные есть (строки или ненулевой итог) → PDF рендерится,
 *   setSessionFile регистрирует ровно одну запись;
 * - happy-path рендера и schema-валидация не меняются.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasExpenseReportData,
  type ExpenseReportData,
} from "../../../src/utils/reports/report-schemas.js";
import { takeSessionFileRecord } from "../../../src/utils/telegram/session-files.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: { reportType: string; data: Record<string, unknown> },
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: string; text?: string }>;
    details?: Record<string, unknown>;
  }>;
}

let tmpHome = "";
let tool: CapturedTool;

before(async () => {
  // REPORTS_DIR вычисляется при загрузке renderer'а из homedir() — направляем
  // в temp, чтобы тесты не писали в ~/.grish-ai/reports пользователя.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "report-home-"));
  process.env.HOME = tmpHome;
  const mod = await import("../../../.pi/extensions/report-generator/index.js");
  let captured: CapturedTool | null = null;
  const pi = {
    registerTool: (t: unknown) => {
      const cand = t as CapturedTool;
      if (cand.name === "generate_report") captured = cand;
    },
  } as unknown as ExtensionAPI;
  mod.default(pi);
  if (!captured) throw new Error("generate_report не зарегистрирован");
  tool = captured;
});

after(() => {
  if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
});

const ctx = {
  sessionManager: { getSessionId: () => "sess-e2" },
};

const emptyData = {
  period: "весь период",
  totalAmount: 0,
  categories: [],
  items: [],
};

describe("hasExpenseReportData (guard E2)", () => {
  it("пустые массивы + 0 → false", () => {
    assert.equal(hasExpenseReportData(emptyData as ExpenseReportData), false);
  });

  it("items непустые → true", () => {
    assert.equal(
      hasExpenseReportData({
        ...emptyData,
        items: [{ date: "d", category: "c", description: "", amount: 1 }],
      } as ExpenseReportData),
      true,
    );
  });

  it("categories непустые → true", () => {
    assert.equal(
      hasExpenseReportData({
        ...emptyData,
        categories: [{ name: "материалы", amount: 10 }],
      } as ExpenseReportData),
      true,
    );
  });

  it("ненулевой итог без строк → true", () => {
    assert.equal(
      hasExpenseReportData({ ...emptyData, totalAmount: 999 } as ExpenseReportData),
      true,
    );
  });
});

describe("generate_report: guard пустого PDF (E2)", () => {
  it("1. empty data → явная ошибка, без файла и без session-file", async () => {
    const res = await tool.execute(
      "c1",
      { reportType: "expense-report", data: emptyData },
      null,
      null,
      ctx,
    );
    assert.equal(res.content[0]!.text, "Нет данных для PDF-отчёта.");
    assert.equal(res.details?.error, "EXPENSE_REPORT_EMPTY: no rows and no total");
    assert.equal(
      takeSessionFileRecord("sess-e2"),
      undefined,
      "session-file НЕ зарегистрирован",
    );
    const reportsDir = path.join(tmpHome, ".grish-ai", "reports");
    const files = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir) : [];
    assert.deepEqual(files, [], "файл на диск НЕ создан");
  });

  it("2. валидные данные → PDF path, session-file зарегистрирован один раз", async () => {
    const res = await tool.execute(
      "c2",
      {
        reportType: "expense-report",
        data: {
          period: "2026-09",
          totalAmount: 1500,
          categories: [{ name: "материалы", amount: 1500 }],
          items: [
            { date: "2026-09-10", category: "материалы", description: "краска", amount: 1500 },
          ],
        },
      },
      null,
      null,
      ctx,
    );
    const filePath = res.details?.path;
    assert.equal(typeof filePath, "string", "PDF path возвращён");
    assert.ok(res.content[0]!.text!.includes("Report generated:"));

    const record = takeSessionFileRecord("sess-e2");
    assert.ok(record, "session-file зарегистрирован");
    assert.equal(record!.filePath, filePath);
    assert.equal(record!.caption, "Отчёт по расходам за 2026-09");
    assert.equal(
      takeSessionFileRecord("sess-e2"),
      undefined,
      "запись ровно одна (после take — пусто)",
    );

    assert.ok(fs.existsSync(filePath as string), "файл существует на диске");
    assert.ok(fs.statSync(filePath as string).size > 0, "файл непустой");
  });

  it("3. schema-валидация прежняя: некорректные данные → Invalid report data", async () => {
    const res = await tool.execute(
      "c3",
      {
        reportType: "expense-report",
        data: { period: "p", totalAmount: "ноль", categories: [], items: [] },
      },
      null,
      null,
      ctx,
    );
    assert.ok(res.content[0]!.text!.includes("Invalid report data"));
    assert.equal(takeSessionFileRecord("sess-e2"), undefined);
  });
});
