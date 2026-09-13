/**
 * Phase 3 (Item 3.1, матрица C1) — token accounting.
 *
 * Контракт §8 master spec: `estimateTokens()`, `getActualUsage()`.
 * Чистые функции; не подключено к production-путям.
 */

export interface ChatMessage {
  role: string;
  content: string;
}

/** Anchor фактического использования от провайдера (usage из ответа API). */
export interface ProviderUsageAnchor {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Бюджет контекста (§8: «Контекст должен иметь budget»). */
export interface ContextBudget {
  maxTokens: number;
  /** Резерв под ответ модели. */
  reservedTokens: number;
}

/** Доступный бюджет на входные сообщения. */
export function usableBudget(budget: ContextBudget): number {
  return Math.max(0, budget.maxTokens - budget.reservedTokens);
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * Детерминированная оценка токенов: ASCII — ~4 символа/токен,
 * CJK — 1 символ/токен. Приближение (без токенизатора провайдера).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let cjk = 0;
  for (const ch of text) if (CJK.test(ch)) cjk++;
  const ascii = text.length - cjk;
  return cjk + Math.ceil(ascii / 4);
}

export function estimateMessageTokens(message: ChatMessage): number {
  // роль входит в подсчёт провайдера, +4 как фикс роли
  return estimateTokens(message.role) + estimateTokens(message.content) + 4;
}

/**
 * Фактическое использование: anchor провайдера выигрывает, иначе оценка.
 * Без anchor prompt = оценка сообщений, completion = 0.
 */
export function getActualUsage(
  messages: ChatMessage[],
  anchor?: ProviderUsageAnchor,
): ProviderUsageAnchor {
  if (anchor && typeof anchor.totalTokens === "number" && anchor.totalTokens > 0) {
    return {
      promptTokens:
        anchor.promptTokens ?? messages.reduce((s, m) => s + estimateMessageTokens(m), 0),
      completionTokens: anchor.completionTokens ?? 0,
      totalTokens: anchor.totalTokens,
    };
  }
  const prompt = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
  return { promptTokens: prompt, completionTokens: 0, totalTokens: prompt };
}
