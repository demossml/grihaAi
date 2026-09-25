/**
 * L1 — единая функция записи experience на завершении turn.
 *
 * Чистая orchestration-функция поверх `TurnExperienceStore`: обрезает
 * поля по лимитам и изолирует любые ошибки — learning никогда не должен
 * ломать ответ пользователю.
 */
import type { TurnExperienceStore } from "./turn-experience.js";

export interface TurnExperienceInput {
  turnId: string;
  task: string;
  assistantResponse?: string;
  success: boolean;
  error?: string;
  toolsUsed?: string[];
  skillId?: string;
  userId?: string;
  sessionKey?: string;
}

export type RecordTurnExperienceResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; error: string };

const TASK_LIMIT = 2000;
const RESULT_LIMIT = 4000;
const ERROR_LIMIT = 1000;

export function recordTurnExperience(
  store: TurnExperienceStore,
  input: TurnExperienceInput,
): RecordTurnExperienceResult {
  try {
    const duplicate = store.hasTurn(input.turnId);
    const rec = store.record({
      turnId: input.turnId,
      task: input.task.slice(0, TASK_LIMIT),
      result: input.assistantResponse?.slice(0, RESULT_LIMIT),
      success: input.success,
      error: input.error?.slice(0, ERROR_LIMIT),
      toolsUsed: input.toolsUsed,
      skillId: input.skillId,
      userId: input.userId,
      sessionKey: input.sessionKey,
    });
    return { ok: true, id: rec.id, duplicate };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
