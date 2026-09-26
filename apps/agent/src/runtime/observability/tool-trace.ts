/**
 * Prompt 05 — ToolTrace: каждый tool call виден + валидация результата.
 *
 * Цель: после критического tool call можно понять —
 *   1) вызван; 2) завершился; 3) технически корректен; 4) соответствует схеме;
 *   5) пригоден для следующего шага.
 *
 * Arguments/result храним как hash/ref, НЕ сырые payloads (могут быть секреты).
 */
import { createHash } from "node:crypto";

export type ToolTraceStatus = "started" | "success" | "failed" | "timeout" | "rejected";

export interface ToolTrace {
  toolCallId: string;
  toolName: string;
  argumentsHash?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: ToolTraceStatus;
  resultRef?: string;
  errorCode?: string;
  retryCount?: number;
}

/** Короткий sha256-хэш аргументов (не храним сырые args). */
export function hashToolArgs(args: unknown): string {
  try {
    return createHash("sha256").update(JSON.stringify(args ?? "")).digest("hex").slice(0, 16);
  } catch {
    return "unserializable";
  }
}

export function buildToolTrace(input: {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  argumentsHash?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: ToolTraceStatus;
  resultRef?: string;
  errorCode?: string;
  retryCount?: number;
}): ToolTrace {
  const argumentsHash =
    input.argumentsHash ?? (input.args !== undefined ? hashToolArgs(input.args) : undefined);
  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    argumentsHash,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    status: input.status,
    resultRef: input.resultRef,
    errorCode: input.errorCode,
    retryCount: input.retryCount,
  };
}

export interface ToolResultValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Минимальный структурный валидатор результата tool.
 * НЕ дублирует TypeBox (вход) / zod (report) — это последняя линия проверки
 * «tool вернул мусор?». При invalid → step type `validation`.
 */
export function validateToolResult(result: unknown): ToolResultValidation {
  if (result === undefined || result === null) {
    return { valid: false, reason: "empty_result" };
  }
  if (result instanceof Error) {
    return { valid: false, reason: "error_result" };
  }
  if (typeof result === "object" && (result as { ok?: unknown }).ok === false) {
    return { valid: false, reason: "explicit_failure" };
  }
  return { valid: true };
}
