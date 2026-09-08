import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import {
  ExpenseReportSchema,
  MeetingMinutesSchema,
  ReportTypeSchema,
  SalesReportSchema,
  REPORT_SCHEMAS,
} from "../../../src/utils/reports/report-schemas.js";

describe("report schemas", () => {
  it("validates sales-report data", () => {
    const valid = { period: "Q1", totalRevenue: 1, categories: [], topDeals: [] };
    assert.equal(Check(SalesReportSchema, valid), true);
    assert.equal(Check(SalesReportSchema, { ...valid, totalRevenue: "не число" }), false);
    assert.equal(Check(SalesReportSchema, { totalRevenue: 1 }), false);
  });

  it("validates expense-report data", () => {
    const valid = {
      period: "Сентябрь",
      totalAmount: 1,
      categories: [{ name: "Офис", amount: 1 }],
      items: [],
    };
    assert.equal(Check(ExpenseReportSchema, valid), true);
    assert.equal(Check(ExpenseReportSchema, { ...valid, items: [{ amount: 1 }] }), false);
  });

  it("validates meeting-minutes data", () => {
    const valid = {
      title: "Планёрка",
      date: "2026-09-08",
      attendees: ["Иван"],
      agenda: ["Бюджет"],
      decisions: [{ text: "Утвердить", owner: "Иван" }],
    };
    assert.equal(Check(MeetingMinutesSchema, valid), true);
    assert.equal(Check(MeetingMinutesSchema, { ...valid, decisions: [{ text: "без владельца" }] }), false);
  });

  it("ReportTypeSchema restricts to the three report types", () => {
    assert.equal(Check(ReportTypeSchema, "sales-report"), true);
    assert.equal(Check(ReportTypeSchema, "expense-report"), true);
    assert.equal(Check(ReportTypeSchema, "meeting-minutes"), true);
    assert.equal(Check(ReportTypeSchema, "invoice"), false);
  });

  it("REPORT_SCHEMAS maps every type to a schema", () => {
    assert.deepEqual(Object.keys(REPORT_SCHEMAS).sort(), [
      "expense-report",
      "meeting-minutes",
      "sales-report",
    ]);
  });
});
