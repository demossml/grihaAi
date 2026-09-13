/**
 * Phase 3 (Item 3.3, матрица C3) — prune старых tool-результатов.
 *
 * Контракт §8 master spec: `pruneToolResults()`. Hermes Phase 1 алгоритма:
 * старые результаты инструментов вычищаются, не-tool сообщения не трогаются.
 * Не «просто обрезаем старые сообщения» — только tool-результаты сверх лимита.
 */
import type { ChatMessage } from "./usage.js";

export type { ChatMessage };

export interface ToolResultPolicy {
  /** Сколько последних tool-результатов сохранять. */
  maxToolResults: number;
  /** Результаты с ошибками сохранять независимо от лимита. */
  keepErrorResults: boolean;
}

export const DEFAULT_TOOL_RESULT_POLICY: ToolResultPolicy = {
  maxToolResults: 8,
  keepErrorResults: true,
};

const ERROR_PATTERN = /error|ошибк|failed|exception/i;

export function isToolResult(message: ChatMessage): boolean {
  return message.role === "tool";
}

function hasError(message: ChatMessage): boolean {
  return ERROR_PATTERN.test(message.content);
}

/**
 * Возвращает сообщения без старых tool-результатов сверх лимита.
 * Инварианты:
 * - не-tool сообщения сохраняются всегда и в исходном порядке;
 * - ошибки (keepErrorResults) не вычищаются;
 * - вычищаются самые старые «лишние» результаты.
 */
export function pruneToolResults(
  messages: ChatMessage[],
  policy: ToolResultPolicy = DEFAULT_TOOL_RESULT_POLICY,
): ChatMessage[] {
  const toolIndexes: number[] = [];
  messages.forEach((m, i) => {
    if (isToolResult(m)) toolIndexes.push(i);
  });
  const removable = new Set<number>();
  // Считаем от хвоста: сколько НЕ-ошибочных результатов уже оставили.
  let kept = 0;
  for (let i = toolIndexes.length - 1; i >= 0; i--) {
    const msg = messages[toolIndexes[i]];
    if (policy.keepErrorResults && hasError(msg)) continue;
    if (kept < policy.maxToolResults) {
      kept++;
      continue;
    }
    removable.add(toolIndexes[i]);
  }
  if (removable.size === 0) return messages;
  return messages.filter((_, i) => !removable.has(i));
}
