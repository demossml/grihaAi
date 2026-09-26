/**
 * Prompt 03 — ContextTrace: происхождение контекста перед моделью.
 *
 * Отвечает на вопрос «почему именно этот контекст оказался перед моделью».
 * Храним ТОЛЬКО структуру происхождения (sourceType + sourceId + reason),
 * НЕ полный текст документов/файлов. Секреты/credentials запрещены.
 */

export type ContextSourceType =
  | "message"
  | "memory"
  | "file"
  | "tool_result"
  | "system"
  | "retrieval"
  | "other";

export interface ContextSource {
  sourceType: ContextSourceType;
  /** id сообщения / файла / memory item (без содержимого). */
  sourceId?: string;
  relevance?: number;
  selected: boolean;
  /** Почему selected или rejected. */
  reason?: string;
  tokenEstimate?: number;
}

export interface ContextTrace {
  sources: ContextSource[];
  estimatedTokens?: number;
  truncated?: boolean;
  truncationReason?: string;
}

/** Сборка ContextTrace (чистая; структура происхождения, без содержимого). */
export function buildContextTrace(
  sources: ContextSource[],
  options: { estimatedTokens?: number; truncated?: boolean; truncationReason?: string } = {},
): ContextTrace {
  return {
    sources,
    estimatedTokens: options.estimatedTokens,
    truncated: options.truncated,
    truncationReason: options.truncationReason,
  };
}
