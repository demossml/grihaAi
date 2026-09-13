import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import {
  decideProactive,
  DEFAULT_PROACTIVE_POLICY,
  type ProactiveEvent,
  type ProactivePolicy,
} from "../../../src/runtime/proactive/decision.js";
import {
  scheduleNudge,
  DEFAULT_NUDGE_POLICY,
  type NudgePolicy,
} from "../../../src/runtime/proactive/nudge.js";

/**
 * W11 (матрица N2, §28) — event-gate для proactive-событий за флагом.
 *
 * §28: event → policy → relevance → security → decision → action.
 * security всегда выше proactive (decideProactive). Flag off = pass всегда
 * (1:1 старое поведение). Nudge (§28 self-improvement): тишина + cooldown +
 * часы; на nudge копится pendingNudgeReason, который следующий брифинг
 * вставляет как подсказку (и очищает).
 */

export interface ProactiveGateState {
  lastActionAtMs?: number;
  lastNudgeAtMs?: number;
  pendingNudgeReason?: string;
}

export interface GateVerdict {
  pass: boolean;
  reason: string;
  relevance: number;
}

export class ProactiveGate {
  private readonly state: ProactiveGateState = {};

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly policy: ProactivePolicy = DEFAULT_PROACTIVE_POLICY,
    private readonly nudgePolicy: NudgePolicy = DEFAULT_NUDGE_POLICY,
  ) {}

  get active(): boolean {
    return isAgentRuntimeEnabled(this.env);
  }

  /** §28 pipeline для события. Off → pass (старое поведение). */
  evaluate(event: ProactiveEvent): GateVerdict {
    if (!this.active) {
      return { pass: true, reason: "runtime off — старое поведение", relevance: 1 };
    }
    const decision = decideProactive(event, this.state.lastActionAtMs, this.policy);
    if (decision.act) {
      this.state.lastActionAtMs = event.atMs;
      return { pass: true, reason: decision.reason, relevance: decision.relevance };
    }
    return { pass: false, reason: decision.reason, relevance: decision.relevance };
  }

  /** Nudge-решение (тишина/cooldown/часы). Off → false. */
  evaluateNudge(nowMs: number, lastActivityAtMs: number): { nudge: boolean; reason: string } {
    if (!this.active) return { nudge: false, reason: "runtime off" };
    const decision = scheduleNudge(
      lastActivityAtMs,
      nowMs,
      this.state.lastNudgeAtMs,
      this.nudgePolicy,
    );
    if (decision.nudge) {
      this.state.lastNudgeAtMs = nowMs;
      this.state.pendingNudgeReason = decision.reason;
    }
    return decision;
  }

  /** Забрать (и очистить) накопленный nudge для вставки в брифинг. */
  takePendingNudge(): string | undefined {
    const reason = this.state.pendingNudgeReason;
    this.state.pendingNudgeReason = undefined;
    return reason;
  }

  /** Последняя активность (для evaluateNudge в тикере). */
  lastActivityAtMs(): number | undefined {
    return this.state.lastActionAtMs;
  }
}
