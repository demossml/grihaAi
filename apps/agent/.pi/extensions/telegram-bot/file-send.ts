/**
 * Валидация файла перед отправкой в Telegram (send_file).
 * Чистые функции — легко тестировать.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Лимит Telegram для ботов: 50 МБ на документ. */
export const TELEGRAM_MAX_FILE_BYTES = 50 * 1024 * 1024;

export type SendFileValidation =
  | { ok: true; resolvedPath: string; sizeBytes: number }
  | { ok: false; error: string };

/** Пути по умолчанию, из которых разрешено отправлять файлы. */
export function defaultFileRoots(): string[] {
  return [os.tmpdir(), process.cwd()];
}

/** Находится ли path внутри root (учёт symlinks через realpath). */
function isInsideRoot(realFile: string, root: string): boolean {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return false;
  }
  const rel = path.relative(realRoot, realFile);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Проверить путь к файлу: существует, обычный файл (не директория),
 * ≤ лимита Telegram, внутри разрешённых каталогов (без произвольного
 * доступа к файловой системе).
 */
export function validateSendFile(
  filePath: string,
  opts?: { maxBytes?: number; allowedRoots?: string[] },
): SendFileValidation {
  const maxBytes = opts?.maxBytes ?? TELEGRAM_MAX_FILE_BYTES;
  const roots = opts?.allowedRoots ?? defaultFileRoots();

  const resolved = path.resolve(filePath);
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    return { ok: false, error: `Файл не найден: ${filePath}` };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    return { ok: false, error: `Файл не найден: ${filePath}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Это не файл (директория?): ${filePath}` };
  }
  if (stat.size > maxBytes) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `Файл ${mb} МБ — больше лимита Telegram (${Math.round(maxBytes / (1024 * 1024))} МБ).`,
    };
  }

  const inAllowedRoot = roots.some((root) => isInsideRoot(real, root));
  if (!inAllowedRoot) {
    return {
      ok: false,
      error: `Путь вне разрешённых каталогов (tmp/рабочая директория): ${filePath}`,
    };
  }

  return { ok: true, resolvedPath: real, sizeBytes: stat.size };
}
