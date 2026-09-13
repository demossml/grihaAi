/**
 * G1 (post-wiring): фоновый review хода более дешёвой моделью за флагом.
 *
 * Hermes: после хода — background review cheaper model. Триггер —
 * `shouldBackgroundReview` (Phase 7, Item 7.5). Здесь — сам LLM-вызов:
 * - только за флагом `HERMES_AGENT_RUNTIME` (off = ничего не происходит);
 * - модель — aux-слот `models.learning` (B5) через `createHttpLearningLlm`;
 * - бюджет: лимит уроков + политика everyNTurns/minTurns триггера;
 * - review НИКОГДА не ломает turn: любые ошибки глушатся → null.
 */
import type { GrishAiConfig } from "@griha/shared-types";
import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import {
  DEFAULT_BACKGROUND_REVIEW_POLICY,
  shouldBackgroundReview,
  type BackgroundReviewPolicy,
  type BackgroundReviewResult,
  type TurnInfo,
} from "../../../src/runtime/learning/background.js";
import type { LearningLlm } from "../../../src/utils/learning/learning-extractor.js";
import { createHttpLearningLlm } from "../../../src/utils/learning/http-learning.js";

export type ReviewLessonKind = "factual" | "procedural" | "preference" | "unknown";

const LESSON_KINDS: ReadonlySet<string> = new Set([
  "factual",
  "procedural",
  "preference",
  "unknown",
]);

const REVIEW_PROMPT = (turn: TurnInfo): string =>
  [
    "Ты — фоновый ревьюер. Проанализируй последний ход агента.",
    `turnIndex: ${turn.turnIndex}`,
    `usedTools: ${turn.usedTools}`,
    `hadError: ${turn.hadError}`,
    "Верни ТОЛЬКО JSON-массив объектов {\"kind\": \"factual|procedural|preference|unknown\", \"content\": \"короткий урок\"} (1–3 урока).",
  ].join("\n");

/** Детерминированный парсер уроков из текста модели (первый JSON-массив). */
export function parseReviewLessons(raw: string, maxLessons = 5): BackgroundReviewResult["lessons"] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const lessons: BackgroundReviewResult["lessons"] = [];
  for (const item of parsed) {
    if (lessons.length >= maxLessons) break;
    if (!item || typeof item !== "object") continue;
    const candidate = item as { kind?: unknown; content?: unknown };
    if (typeof candidate.content !== "string" || candidate.content.trim() === "") continue;
    const kind = LESSON_KINDS.has(String(candidate.kind)) ? String(candidate.kind) : "unknown";
    lessons.push({ content: candidate.content.trim(), kind: kind as ReviewLessonKind });
  }
  return lessons;
}

export interface BackgroundReviewOptions {
  /** Конфиг (может отсутствовать — review пропускается). */
  config: GrishAiConfig | null;
  /** Env для feature-флага; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Политика триггера; default — DEFAULT_BACKGROUND_REVIEW_POLICY. */
  policy?: BackgroundReviewPolicy;
  /** Максимум уроков за review (бюджет G1). */
  maxLessons?: number;
  /** Инъектируемый LLM для тестов; default — createHttpLearningLlm. */
  llm?: LearningLlm;
  now?: () => string;
}

/**
 * Запускает фоновый review хода, если флаг включён и триггер сработал.
 * Возвращает null, если review не нужен/невозможен/упал — turn не ломается.
 */
export async function maybeBackgroundReview(
  turn: TurnInfo,
  options: BackgroundReviewOptions,
): Promise<BackgroundReviewResult | null> {
  const env = options.env ?? process.env;
  if (!isAgentRuntimeEnabled(env)) return null;
  if (!options.config) return null;
  const decision = shouldBackgroundReview(turn, options.policy ?? DEFAULT_BACKGROUND_REVIEW_POLICY);
  if (!decision.review) return null;

  const llm = options.llm ?? createHttpLearningLlm(options.config, { env });
  try {
    const raw = await llm(REVIEW_PROMPT(turn));
    const lessons = parseReviewLessons(raw, options.maxLessons ?? 5);
    return {
      turnIndex: turn.turnIndex,
      lessons,
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
    };
  } catch {
    // Background review — best-effort: никогда не ломать ход агента.
    return null;
  }
}
