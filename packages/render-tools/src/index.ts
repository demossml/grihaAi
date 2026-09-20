export { renderDocument } from "./render.js";
export { listTemplates } from "./templates/registry.js";
export { SpecBuilder, type Spec, type SpecElement } from "./templates/spec.js";
export { REPORT_COLORS, PAGE } from "./layout/tokens.js";
export { buildReportShellSpec, addReportHeader, addReportFooter, type ReportShellOptions } from "./layout/shell.js";
export { addReportTable, type ReportTableColumn, type ReportTableOptions, type TableAlign } from "./layout/table.js";
