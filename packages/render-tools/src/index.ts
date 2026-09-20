export { renderDocument } from "./render.js";
export { listTemplates } from "./templates/registry.js";
export { SpecBuilder, type Spec, type SpecElement } from "./templates/spec.js";
export { REPORT_COLORS, PAGE } from "./layout/tokens.js";
export { buildReportShellSpec, addReportHeader, addReportFooter, type ReportShellOptions } from "./layout/shell.js";
export { addReportTable, type ReportTableColumn, type ReportTableOptions, type TableAlign } from "./layout/table.js";
export type {
  ExpenseLineItem,
  ExpenseReceiptBlock,
  ExpenseSupplierRow,
  ExpenseReportInput,
} from "./templates/expenseReportTypes.js";
export type { SalesReportInput } from "./templates/salesReport.js";
export type { SellersReportInput } from "./templates/sellersReport.js";
export type { RevenueReportInput } from "./templates/revenueReport.js";
export type { ProfitReportInput } from "./templates/profitReport.js";
export type { GenericTableReportInput, GenericTableColumn } from "./templates/genericTableReport.js";
export { formatMoney, formatCount } from "./layout/format.js";
