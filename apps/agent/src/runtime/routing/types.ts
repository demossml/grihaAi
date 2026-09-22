import type { TaskComplexity, TaskKind } from "../generation/types.js";

/** Роль рантайма после маршрутизации. */
export type RoutedModelRole = "flash" | "main" | "vision";

export interface RoutingContext {
  /** Текст текущего user-сообщения (уже обрезанный вызывающим). max держать снаружи ≤ 2000 chars */
  userText: string;
  /** Есть photo/document image */
  hasImage?: boolean;
  /** Есть voice */
  hasVoice?: boolean;
  /** Явный tool-only / report intent от host (если host уже знает) */
  hostHint?: "report" | "analysis" | "chat" | "ocr" | "unknown";
  /** chatType если есть */
  chatType?: "private" | "group" | "supergroup" | "channel" | "unknown";
}

export interface RoutingDecision {
  role: RoutedModelRole;
  complexity: TaskComplexity;
  kind: TaskKind;
  /** 0..1 */
  confidence: number;
  /** rule | flash_llm | fallback */
  source: "rule" | "flash_llm" | "fallback";
  /** короткая причина для obs/log, без user PII dump */
  reason: string;
}

export interface FlashRouterDeps {
  /**
   * Вызов Flash LLM. messages уже подготовлены.
   * Должен вернуть СЫРОЙ текст ответа модели (ожидаем JSON).
   */
  callFlash: (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string>;
  /** timeout ms default 8000 */
  timeoutMs?: number;
}
