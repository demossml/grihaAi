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
});
export type ExpenseReportData = Static<typeof ExpenseReportSchema>;

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
