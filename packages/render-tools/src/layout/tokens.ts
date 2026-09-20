/**
 * Единый design kit для всех PDF-отчётов: цвета и базовые размеры страницы.
 */

export const REPORT_COLORS = {
  dark: "#2d3748",
  text: "#1a202c",
  muted: "#718096",
  border: "#e2e8f0",
  stripe: "#f7fafc",
  headBg: "#edf2f7",
  accent: "#2b6cb0",
  white: "#ffffff",
} as const;

export const PAGE = {
  size: "A4" as const,
  marginMm: 16,
};
