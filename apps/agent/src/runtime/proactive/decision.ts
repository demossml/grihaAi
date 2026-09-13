/**
 * Phase 14 (Item 14.1, матрица N2 + §28) — решение proactive-действий.
 *
 * §28: event → policy → relevance → decision → action.
 * proactive ≠ autonomous unrestricted action: security policy всегда выше
 * proactive policy.
 */
import { classifyAction, type RiskLevel } from "../security/risk.js";

export type ProactiveEventKind =
  | "briefing"
  | "anomaly"
  | "calendar"
  | "nudge"
  | "self-improvement";

export interface ProactiveEvent {
  kind: ProactiveEventKind;
  /** Действие, которое предложено выполнить (для risk-проверки). */
  action?: Parameters<typeof classifyAction>[0];
  /** Релевантность-контекст (например, текст для скоринга). */
  context: string;
  atMs: number;
}

export interface ProactivePolicy {
  /** Разрешённые типы событий. */
  allowedKinds: ProactiveEventKind[];
  /** Порог релевантности (0..1). */
  relevanceThreshold: number;
  /** Максимальный риск действия, которое proactive может выполнить сам. */
  maxAutonomousRisk: RiskLevel;
  /** Cooldown между proactive-действиями, ms. */
  cooldownMs: number;
}

export const DEFAULT_PROACTIVE_POLICY: ProactivePolicy = {
  allowedKinds: ["briefing", "anomaly", "calendar", "nudge"],
  relevanceThreshold: 0.5,
  maxAutonomousRisk: "medium",
  cooldownMs: 60_000,
};

export interface ProactiveDecision {
  act: boolean;
  reason: string;
  relevance: number;
}

const RISK_ORDER: RiskLevel[] = ["safe", "low", "medium", "high", "critical"];

/**
 * Оценка релевантности: детерминированный скоринг по маркерам в контексте.
 * 0..1. Плацебо-эвристика до подключения модели релевантности (B5).
 */
export function evaluateRelevance(event: ProactiveEvent): number {
  const text = event.context.toLowerCase();
  let score = 0;
  if (/(срочно|важно|дедлайн|deadline|urgent|важно!)/i.test(text)) score += 0.4;
  if (/(аномалия|ошибк|провал|аномал)/i.test(text)) score += 0.3;
  if (/(встреч|событи|напомни|напоминание)/i.test(text)) score += 0.2;
  if (text.length > 20) score += 0.1;
  return Math.min(1, score);
}

/**
 * §28 pipeline: policy → relevance → security → decision.
 * Security выше proactive: риск действия выше maxAutonomousRisk → не
 * выполняется автономно (нужно approval).
 */
export function decideProactive(
  event: ProactiveEvent,
  lastActionAtMs: number | undefined,
  policy: ProactivePolicy = DEFAULT_PROACTIVE_POLICY,
): ProactiveDecision {
  const relevance = evaluateRelevance(event);
  if (!policy.allowedKinds.includes(event.kind)) {
    return { act: false, reason: `тип ${event.kind} не разрешён политикой`, relevance };
  }
  if (
    typeof lastActionAtMs === "number" &&
    event.atMs - lastActionAtMs < policy.cooldownMs
  ) {
    return { act: false, reason: "cooldown", relevance };
  }
  if (relevance < policy.relevanceThreshold) {
    return { act: false, reason: `relevance ${relevance} < порог ${policy.relevanceThreshold}`, relevance };
  }
  if (event.action) {
    const risk = classifyAction(event.action);
    if (RISK_ORDER.indexOf(risk.level) > RISK_ORDER.indexOf(policy.maxAutonomousRisk)) {
      return {
        act: false,
        reason: `security выше proactive: риск ${risk.level} > ${policy.maxAutonomousRisk} — требуется approval`,
        relevance,
      };
    }
  }
  return { act: true, reason: "relevance и security пройдены", relevance };
}
