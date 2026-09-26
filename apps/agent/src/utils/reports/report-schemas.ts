import { Type, type Static, type TSchema } from "typebox";

/**
 * TypeBox schemas for the report-generator. Validation runs BEFORE rendering,
 * so a malformed payload produces a clear tool error instead of a broken PDF.
 */

export const SalesReportSchema = Type.Object({
  period: Type.String({ minLength: 1 }),
  totalRevenue: Type.Number(),
  categories: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      revenue: Type.Number(),
    }),
  ),
  topDeals: Type.Array(
    Type.Object({
      title: Type.String({ minLength: 1 }),
      amount: Type.Number(),
    }),
  ),
});
export type SalesReportData = Static<typeof SalesReportSchema>;

export const ExpenseReportSchema = Type.Object({
  period: Type.String({ minLength: 1 }),
  totalAmount: Type.Number(),
  categories: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      amount: Type.Number(),
    }),
  ),
  items: Type.Array(
    Type.Object({
      date: Type.String({ minLength: 1 }),
      category: Type.String({ minLength: 1 }),
      description: Type.String(),
      amount: Type.Number(),
    }),
  ),
  // Кол-во чеков, требующих ручной проверки (не смешиваются с успешными строками).
  needsReviewCount: Type.Optional(Type.Integer()),
});
export type ExpenseReportData = Static<typeof ExpenseReportSchema>;

/**
 * E2: guard от «успешного» пустого PDF. Рендер и setSessionFile разрешены
 * только при наличии хотя бы одной строки (items/categories) ИЛИ ненулевого
 * конечного итога. Пустые массивы + 0 → false (tool вернёт ошибку, файл не
 * создаётся).
 */
export function hasExpenseReportData(data: ExpenseReportData): boolean {
  const hasRows =
    (Array.isArray(data.items) && data.items.length > 0) ||
    (Array.isArray(data.categories) && data.categories.length > 0);
  const hasTotal =
    typeof data.totalAmount === "number" &&
    Number.isFinite(data.totalAmount) &&
    data.totalAmount !== 0;
  return hasRows || hasTotal;
}

export const MeetingMinutesSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  date: Type.String({ minLength: 1 }),
  attendees: Type.Array(Type.String({ minLength: 1 })),
  agenda: Type.Array(Type.String({ minLength: 1 })),
  decisions: Type.Array(
    Type.Object({
      text: Type.String({ minLength: 1 }),
      owner: Type.String({ minLength: 1 }),
    }),
  ),
});
export type MeetingMinutesData = Static<typeof MeetingMinutesSchema>;

export const ReportTypeSchema = Type.Union([
  Type.Literal("sales-report"),
  Type.Literal("expense-report"),
  Type.Literal("meeting-minutes"),
]);
export type ReportType = Static<typeof ReportTypeSchema>;

/** Maps a report type to its data schema. */
export const REPORT_SCHEMAS: Record<ReportType, TSchema> = {
  "sales-report": SalesReportSchema,
  "expense-report": ExpenseReportSchema,
  "meeting-minutes": MeetingMinutesSchema,
};
