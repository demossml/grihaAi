import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import {
  DEFAULT_TOOL_RESULT_POLICY,
  isToolResult,
  pruneToolResults,
} from "../../../src/runtime/context/prune.js";
import type { ChatMessage } from "../../../src/runtime/context/usage.js";

/**
 * C3 (матрица C3, §8) — prune старых tool-результатов в конвейере сообщений.
 *
 * Подключено к `context`-событию агентского цикла: перед каждым LLM-вызовом
 * старые tool-результаты сверх лимита вычищаются (не-tool сообщения и
 * ошибки не трогаются). Flag off → null (конвейер не меняется, 1:1).
 */

function toChatMessage(message: { role?: unknown; content?: unknown }): ChatMessage {
  return {
    role: typeof message.role === "string" ? message.role : "",
    content:
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? ""),
  };
}

/**
 * Возвращает отфильтрованный массив (только при удалении), иначе null.
 * Порядок и объекты сохранённых сообщений не меняются.
 */
export function pruneAgentToolResults<T extends { role?: unknown; content?: unknown }>(
  messages: readonly T[],
  env: NodeJS.ProcessEnv,
): T[] | null {
  if (!isAgentRuntimeEnabled(env)) return null;
  const mapped: ChatMessage[] = messages.map((m) => toChatMessage(m));
  if (!mapped.some((m) => isToolResult(m))) return null;
  const pruned = pruneToolResults(mapped, DEFAULT_TOOL_RESULT_POLICY);
  if (pruned.length === mapped.length) return null;
  const kept = new Set(pruned.map((pm) => mapped.findIndex((om) => om === pm)));
  return messages.filter((_, i) => kept.has(i)) as T[];
}
