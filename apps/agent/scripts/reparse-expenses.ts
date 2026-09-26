/**
 * CLI backfill: переразбор expense_documents из сохранённого OCR rawText.
 *
 * Запуск:
 *   npx tsx apps/agent/scripts/reparse-expenses.ts --dry-run --limit=50
 *   npx tsx apps/agent/scripts/reparse-expenses.ts --limit=200
 *   npx tsx apps/agent/scripts/reparse-expenses.ts --all --limit=200 --chat-id=-5400215325
 *
 * Фото из Telegram не скачиваются — нужен сохранённый OCR text
 * (expense.raw_text или chat_archive.raw_text по file_unique_id).
 *
 * Exit code: 0 при любом итоге (в т.ч. partial errors), 1 — только если БД
 * не открылась.
 */
import path from "node:path";
import { reparseExpenses, type ReparseOptions } from "../src/services/documents/reparse-expenses.js";

function parseArgs(argv: string[]): ReparseOptions {
  const opts: ReparseOptions = {};
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--all") opts.onlyProblematic = false;
    else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) opts.limit = Math.trunc(n);
    } else if (a.startsWith("--chat-id=")) {
      const v = a.slice("--chat-id=".length).trim();
      if (v) opts.chatId = v;
    }
  }
  return opts;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return !!entry && path.resolve(entry).endsWith(path.join("scripts", "reparse-expenses.ts"));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const summary = await reparseExpenses(opts);
    const counts =
      `scanned=${summary.scanned} updated=${summary.updated} skipped=${summary.skipped} ` +
      `unchanged=${summary.unchanged} errors=${summary.errors}`;
    console.log(`[reparse-expenses] ${opts.dryRun ? "(dry-run) " : ""}${counts}`);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error(
      `[reparse-expenses] DB open failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  void main();
}
