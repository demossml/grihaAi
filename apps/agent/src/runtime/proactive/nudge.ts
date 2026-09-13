/**
 * Phase 14 (Item 14.2, матрица N2) — background nudge/self-improvement.
 *
 * На базе G1-триггера (Phase 7.5): плановый nudge по тишине + cooldown.
 * Чистая функция с инъекцией времени.
 */

export interface NudgePolicy {
  /** Порог тишины: сколько ms без активности до nudge. */
  idleThresholdMs: number;
  /** Cooldown между nudge. */
  cooldownMs: number;
  /** Время суток (часы), когда nudge разрешён (24h). */
  allowedHours: [number, number];
}

export const DEFAULT_NUDGE_POLICY: NudgePolicy = {
  idleThresholdMs: 6 * 60 * 60 * 1000, // 6 часов
  cooldownMs: 3 * 60 * 60 * 1000, // 3 часа
  allowedHours: [9, 22],
};

export interface NudgeDecision {
  nudge: boolean;
  reason: string;
}

/** Решение о nudge self-improvement по последней активности. */
export function scheduleNudge(
  lastActivityAtMs: number,
  nowMs: number,
  lastNudgeAtMs: number | undefined,
  policy: NudgePolicy = DEFAULT_NUDGE_POLICY,
): NudgeDecision {
  if (nowMs - lastActivityAtMs < policy.idleThresholdMs) {
    return { nudge: false, reason: "активность недавняя — nudge не нужен" };
  }
  if (typeof lastNudgeAtMs === "number" && nowMs - lastNudgeAtMs < policy.cooldownMs) {
    return { nudge: false, reason: "cooldown nudge не истёк" };
  }
  const hour = new Date(nowMs).getHours();
  const [start, end] = policy.allowedHours;
  if (start <= end ? hour < start || hour >= end : hour < start && hour >= end) {
    return { nudge: false, reason: `вне разрешённых часов (${start}–${end})` };
  }
  return { nudge: true, reason: "тишина превышает порог — запланировать nudge" };
}
