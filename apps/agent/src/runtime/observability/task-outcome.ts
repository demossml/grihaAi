/**
 * Prompt 07 — TaskOutcome: технический success ≠ реальный success для пользователя.
 *
 * Не пытаемся судить «качество ответа» по отсутствию exception/HTTP 200.
 * Отделяем «модель ответила без ошибки» от «задача реально закрыта».
 */

export type TaskOutcome =
  | "completed"
  | "partially_completed"
  | "failed"
  | "blocked"
  | "needs_user_input"
  | "unknown";

/**
 * Детерминированный исход задачи по сигналам terminal state хода.
 * `needsUserInput` — например, approval-gate запросил подтверждение (inline-кнопки).
 */
export function computeTaskOutcome(input: {
  ok: boolean;
  hadReply?: boolean;
  needsUserInput?: boolean;
}): TaskOutcome {
  if (!input.ok) return "failed";
  if (input.needsUserInput) return "needs_user_input";
  if (input.hadReply) return "completed";
  return "unknown";
}
