/**
 * Phase 6 (Item 6.2, матрица F2) — построчный diff (LCS).
 *
 * Основа для patch-операций и validation в versioning (F3).
 * Чистые функции без I/O.
 */

export type DiffOpKind = "same" | "remove" | "add";

export interface DiffOp {
  kind: DiffOpKind;
  line: string;
}

/** Разбиение на строки (последняя пустая строка игнорируется). */
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * LCS-based построчный diff. O(n*m) — скиллы малы, детерминированно.
 */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "remove", line: a[i] });
      i++;
    } else {
      ops.push({ kind: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "remove", line: a[i++] });
  while (j < m) ops.push({ kind: "add", line: b[j++] });
  return ops;
}

/** Количество изменённых строк (remove+add) — метрика размера изменения. */
export function diffChangeCount(ops: readonly DiffOp[]): number {
  return ops.filter((op) => op.kind !== "same").length;
}

/** Собирает новый текст применением ops к старому (контрольная проверка diff). */
export function applyDiff(ops: readonly DiffOp[]): string {
  return ops.filter((op) => op.kind !== "remove").map((op) => op.line).join("\n");
}
