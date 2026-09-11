/**
 * Валидация файла перед отправкой в Telegram (send_file).
 * Чистые функции — легко тестировать.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfigDir } from "@griha/config";

/** Лимит Telegram для ботов: 50 МБ на документ. */
export const TELEGRAM_MAX_FILE_BYTES = 50 * 1024 * 1024;

export type SendFileValidation =
  | { ok: true; resolvedPath: string; sizeBytes: number }
  | { ok: false; error: string };

/**
 * Пути по умолчанию, из которых разрешено отправлять файлы (B2):
 * cwd, корень монорепо (если cwd — apps/agent), tmp, ~/.grish-ai и media-стор.
 */
export function defaultFileRoots(): string[] {
  const configDir = path.resolve(getConfigDir());
  return [
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), "../.."), // корень монорепо (cwd = apps/agent)
    os.tmpdir(),
    configDir,
    path.join(configDir, "media"), // постоянное MediaStorage
  ];
}

/** B1: путь обязан быть внутри одного из корней (без ../ и симлинков наружу). */
export function assertAllowedPath(abs: string, roots: string[]): void {
  const normalize = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      // Файла может ещё не быть (check later) — резолвим ближайший существующий
      // родитель, чтобы macOS-симлинки (/var → /private/var) не дали false negative.
      let dir = path.dirname(p);
      while (dir !== path.dirname(dir)) {
        try {
          return path.join(fs.realpathSync(dir), path.basename(p));
        } catch {
          dir = path.dirname(dir);
        }
      }
      return path.resolve(p);
    }
  };
  const normalizedRoots = roots.map(normalize);
  const real = normalize(abs);
  const ok = normalizedRoots.some((r) => real === r || real.startsWith(r + path.sep));
  if (!ok) {
    throw new Error(
      `path not in allowed roots: ${abs}. Allowed: ${normalizedRoots.join(", ")}`,
    );
  }
}

/**
 * B1: единый resolver исходящего файла — storageKey (медиа-архив) ИЛИ filePath.
 * storageKey НЕ является путём: его обрабатывает resolveStorageKey.
 */
export async function resolveOutboundFile(
  input: { filePath?: string; storageKey?: string },
  deps: {
    resolveStorageKey: (key: string) => Promise<string | null>;
    allowedRoots: string[];
  },
): Promise<{ absolutePath: string; source: "path" | "storage" }> {
  if (input.storageKey && input.storageKey.trim()) {
    const p = await deps.resolveStorageKey(input.storageKey.trim());
    if (!p) throw new Error(`storageKey not found: ${input.storageKey}`);
    return { absolutePath: p, source: "storage" };
  }
  if (input.filePath && input.filePath.trim()) {
    const abs = path.resolve(input.filePath);
    assertAllowedPath(abs, deps.allowedRoots);
    if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
    return { absolutePath: abs, source: "path" };
  }
  throw new Error("Provide filePath or storageKey");
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
