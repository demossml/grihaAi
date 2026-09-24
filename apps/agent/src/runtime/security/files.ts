/**
 * Phase 11 (Item 11.3, матрица K3) — безопасность файловых путей.
 *
 * Проверка путей перед файловыми операциями: без `..`, без абсолютных путей
 * вне разрешённых корней, классификация операций для approval (K2).
 */
import { isAbsolute, normalize, resolve } from "node:path";
import { classifyAction, type ActionRisk } from "./risk.js";

export interface FileOperationSpec {
  operation: "read" | "write" | "delete";
  path: string;
}

/** Безопасен ли путь относительно разрешённых корней (resolve+normalize). */
export function isSafePath(path: string, allowedRoots: readonly string[]): boolean {
  const p = path.trim();
  if (!p) return false;
  if (p.startsWith("~")) return false; // home — не считаем safe
  if (p.startsWith("\\\\") || p.startsWith("//")) return false; // UNC/сетевой путь
  const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
  const normalized = normalize(abs);
  return allowedRoots.some((root) => {
    const r = normalize(root);
    return normalized === r || normalized.startsWith(r.endsWith("/") ? r : r + "/");
  });
}

export interface FileSafetyResult {
  safe: boolean;
  reason: string;
  risk: ActionRisk;
}

/** Проверка файловой операции: безопасность пути + классификация риска (K2). */
export function checkFileOperation(
  spec: FileOperationSpec,
  allowedRoots: readonly string[],
): FileSafetyResult {
  const risk = classifyAction(
    spec.operation === "read" ? "read_file" : spec.operation === "write" ? "write_file" : "delete_file",
  );
  if (!isSafePath(spec.path, allowedRoots)) {
    return { safe: false, reason: `путь вне разрешённых корней: ${spec.path}`, risk };
  }
  return { safe: true, reason: "путь в пределах корней", risk };
}

/** Классификация файловой операции по имени (для approval-цепочки). */
export function fileOperationRisk(operation: FileOperationSpec["operation"]): ActionRisk {
  return classifyAction(
    operation === "read" ? "read_file" : operation === "write" ? "write_file" : "delete_file",
  );
}
