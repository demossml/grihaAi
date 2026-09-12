/**
 * One-shot backfill: пересчитать total в expense_documents по raw_text
 * исправленным parseTotalFromText (R1 — приоритет «ИТОГ», не НДС).
 *
 * Запуск (из корня репо):
 *   npx tsx tools/backfill-totals/backfill.ts [dbPath] [--apply]
 * Без --apply — dry-run (только отчёт о расхождениях).
 *
 * dbPath default: ~/.grish-ai/documents.sqlite (GRISH_AI_HOME переопределяет базу).
 */
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { parseTotalFromText } from "../../apps/agent/src/services/documents/extractors/parsers.js";

function defaultDbPath(): string {
  const base = process.env.GRISH_AI_HOME ?? os.homedir();
  return path.join(base, ".grish-ai", "documents.sqlite");
}

interface Row {
  id: string;
  chat_id: string;
  total: number | null;
  raw_text: string | null;
  supplier: string | null;
  doc_date: string;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbPath = args.find((a) => !a.startsWith("--")) ?? defaultDbPath();

const db = new Database(dbPath, { readonly: !apply });
const rows = db
  .prepare(
    `SELECT id, chat_id, total, raw_text, supplier, doc_date
     FROM expense_documents
     WHERE raw_text IS NOT NULL AND raw_text != ''`,
  )
  .all() as Row[];

let changed = 0;
let skipped = 0;
const examples: Array<{ id: string; old: number | null; next: number }> = [];

const update = db.prepare(`UPDATE expense_documents SET total = ?, updated_at = ? WHERE id = ?`);
const tx = apply ? db.transaction(() => undefined) : null;
if (apply && tx) tx();

for (const row of rows) {
  const next = parseTotalFromText(row.raw_text ?? "");
  if (next === undefined) {
    skipped++;
    continue;
  }
  if (row.total !== null && Math.abs(row.total - next) < 0.005) continue;
  changed++;
  if (examples.length < 10) examples.push({ id: row.id, old: row.total, next });
  if (apply) {
    update.run(next, new Date().toISOString(), row.id);
  }
}

console.log(`Строк с raw_text: ${rows.length}`);
console.log(`Пересчитано: ${changed}${apply ? " (применено)" : " (dry-run)"}`);
console.log(`Без итога (пропущено): ${skipped}`);
for (const e of examples) {
  console.log(`  ${e.id}: ${e.old ?? "null"} → ${e.next}`);
}
db.close();
