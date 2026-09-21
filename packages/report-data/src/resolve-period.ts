/**
 * Разрешение периода отчёта. Без fromDate/toDate → полная история (fullHistory).
 */

export function isValidYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function resolveReportPeriod(period?: { fromDate?: string; toDate?: string }): {
  fromDate: string | null;
  toDate: string | null;
  fullHistory: boolean;
} {
  const from = period?.fromDate?.trim() || null;
  const to = period?.toDate?.trim() || null;
  if (!from && !to) {
    return { fromDate: null, toDate: null, fullHistory: true };
  }
  return { fromDate: from, toDate: to, fullHistory: false };
}
