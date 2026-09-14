import {
  classifyDeliveryError,
  deliveryStatusFromError,
  shouldRetry,
  DEFAULT_DELIVERY_POLICY,
  type DeliveryPolicy,
  type DeliveryStatus,
  type DeliveryTarget,
} from "../../../src/runtime/telegram/delivery.js";

/**
 * W10 (матрица M4) — транспорт Cron → Telegram за флагом.
 *
 * P02-семантика: execution ≠ delivery (статус доставки не влияет на status
 * задачи); временные ошибки → ретраи, permanent → стоп. Telegram-слой НЕ
 * меняется: telegram-bot регистрирует `sendNotify`-notifier (как
 * `setExpenseBriefNotifier`); без notifier доставка = skipped.
 */

export type CronDeliveryNotifier = (target: DeliveryTarget, text: string) => Promise<void>;

/** M4 (thread_id): параметры sendNotify из DeliveryTarget (J5 chat_id/thread_id). */
export function notifierArgs(
  target: DeliveryTarget,
): { chatId: number; messageThreadId?: number } {
  const args: { chatId: number; messageThreadId?: number } = {
    chatId: Number(target.chatId),
  };
  if (target.threadId !== undefined) {
    args.messageThreadId = Number(target.threadId);
  }
  return args;
}

let notifier: CronDeliveryNotifier | null = null;

/** Регистрация транспорта (telegram-bot при старте). */
export function setCronDeliveryNotifier(fn: CronDeliveryNotifier | null): void {
  notifier = fn;
}

export interface CronDeliveryOutcome {
  status: DeliveryStatus;
  attempts: number;
}

/** Доставка с P02-ретраями. Никогда не бросает — статус в результате. */
export async function deliverCronResult(
  target: DeliveryTarget,
  text: string,
  policy: DeliveryPolicy = DEFAULT_DELIVERY_POLICY,
): Promise<CronDeliveryOutcome> {
  if (!notifier) return { status: "skipped", attempts: 0 };
  let attempts = 1;
  for (;;) {
    try {
      await notifier(target, text);
      return { status: "ok", attempts };
    } catch (error) {
      const kind = classifyDeliveryError(error);
      const decision = shouldRetry(kind, attempts, policy);
      if (!decision.retry) {
        return { status: deliveryStatusFromError(kind), attempts };
      }
      await new Promise((resolve) => setTimeout(resolve, policy.retryDelayMs));
      attempts++;
    }
  }
}
