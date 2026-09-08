/**
 * Минимально достаточный бэкап SQLite-баз Гриши.
 *
 * Для каждого ~/.grish-ai/*.sqlite делает консистентный снимок через
 * `VACUUM INTO` (безопасно при открытой БД и WAL — в отличие от голого cp,
 * который поверх WAL может скопировать файл без хвоста журнала).
 * Снимки кладутся в ~/.grish-ai/backups/<ISO-дата-время>/; хранятся последние
 * BACKUP_KEEP (по умолчанию 7) бэкапов, более старые удаляются.
 *
 * Запуск: `npx tsx apps/agent/scripts/backup.ts` (или systemd-таймером,
 * см. deploy/griha-ai-backup.timer). Работает независимо от того, запущен ли
 * агент — это системная обвязка, а не cron-расширение.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getConfigDir } from "@griha/config";

export const DEFAULT_BACKUP_KEEP = 7;
export const BACKUP_DIR_NAME = "backups";

/** ISO-дата-время без ':' и '.' — имя каталога бэкапа, сортируется хронологически. */
export function backupStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Оставляет последние `keep` каталогов бэкапов (сортировка по имени — ISO-
 * штампы сортируются хронологически), удаляет остальные.
 */
export function rotateBackups(
  backupsDir: string,
  keep: number,
): { kept: string[]; removed: string[] } {
  const names = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const cut = Math.max(0, names.length - keep);
  const removed = names.slice(0, cut);
  for (const name of removed) {
    fs.rmSync(path.join(backupsDir, name), { recursive: true, force: true });
  }
  return { kept: names.slice(cut), removed };
}

export interface BackupResult {
  destination: string;
  ok: string[];
  failed: Array<{ file: string; error: string }>;
}

/** Снимок всех *.sqlite из configDir в новый каталог backupsDir/<stamp>/. */
export function backupSqliteFiles(
  configDir: string,
  backupsDir: string,
  now: Date = new Date(),
): BackupResult {
  const destination = path.join(backupsDir, backupStamp(now));
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  fs.chmodSync(destination, 0o700);

  const files = fs
    .readdirSync(configDir)
    .filter((f) => f.endsWith(".sqlite"))
    .sort();

  const ok: string[] = [];
  const failed: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    const src = path.join(configDir, file);
    const dest = path.join(destination, file);
    let db: Database.Database | null = null;
    try {
      db = new Database(src);
      db.pragma("busy_timeout = 5000");
      db.prepare("VACUUM INTO ?").run(dest);
      fs.chmodSync(dest, 0o600);
      ok.push(file);
    } catch (err: unknown) {
      failed.push({ file, error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (db) db.close();
    }
  }
  return { destination, ok, failed };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return !!entry && path.resolve(entry).endsWith(path.join("scripts", "backup.ts"));
}

function main(): void {
  const configDir = getConfigDir();
  const backupsDir = path.join(configDir, BACKUP_DIR_NAME);
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupsDir, 0o700);

  const keep = Number(process.env.BACKUP_KEEP ?? DEFAULT_BACKUP_KEEP);
  const result = backupSqliteFiles(configDir, backupsDir);
  for (const f of result.failed) {
    console.error(`[backup] FAILED ${f.file}: ${f.error}`);
  }
  const rotation = rotateBackups(backupsDir, Number.isFinite(keep) && keep > 0 ? Math.trunc(keep) : DEFAULT_BACKUP_KEEP);
  console.log(
    `[backup] ${result.ok.length}/${result.ok.length + result.failed.length} sqlite files → ${result.destination}` +
      (rotation.removed.length ? ` (removed old backups: ${rotation.removed.join(", ")})` : ""),
  );
}

if (isMainModule()) {
  main();
}
