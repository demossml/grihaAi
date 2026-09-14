/**
 * PROMPT 6: claim-and-lease idempotency входящих Telegram updates (дизайн
 * PROMPT 5, утверждён с уточнениями).
 *
 * Семантика:
 *   - claim сразу после normalize, до тяжёлой работы;
 *   - SKIP (duplicate_in_flight / duplicate_done) → без агента и outbound;
 *   - done ТОЛЬКО после успешной обработки (sendReply); сбой/краш →
 *     processing живёт до истечения lease → redelivery делает reclaim и
 *     переигрывает (сообщение не теряется);
 *   - fail-open: сбой claim'а НЕ роняет апдейт — обрабатываем без дедупа
 *     (деградация лучше потери сообщения).
 *
 * Env:
 *   TELEGRAM_UPDATE_LEASE_MS — lease (default 30 мин);
 *   TELEGRAM_UPDATE_DEDUP=0  — полный bypass (откат без миграции назад).
 */
import { logTelegramError } from "../../../.pi/extensions/telegram-bot/telegram-diagnostics.js";
import { DocumentsRepository, type UpdateClaimResult } from "./DocumentsRepository.js";

export const DEFAULT_UPDATE_LEASE_MS = 30 * 60 * 1000;
/** TTL завершённых строк processed_updates (14 дней). */
export const PROCESSED_UPDATES_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface TelegramUpdateDedupOptions {
  /** Lease в мс. Default DEFAULT_UPDATE_LEASE_MS. */
  leaseMs?: number;
  /** true → bypass (claim всегда "ok", done — no-op). */
  disabled?: boolean;
}

export class TelegramUpdateDedup {
  private readonly leaseMs: number;
  private readonly disabled: boolean;

  constructor(
    private readonly repo: DocumentsRepository,
    private readonly now: () => number = Date.now,
    options: TelegramUpdateDedupOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? DEFAULT_UPDATE_LEASE_MS;
    this.disabled = options.disabled === true;
    // Стартовая TTL-очистка завершённых строк (идемпотентно).
    try {
      this.repo.cleanupProcessedUpdates(this.now() - PROCESSED_UPDATES_TTL_MS);
    } catch (err: unknown) {
      logTelegramError({ operation: "update_dedup_cleanup", error: err });
    }
  }

  claim(updateId: number): UpdateClaimResult {
    if (this.disabled) return "ok";
    try {
      return this.repo.claimProcessedUpdate(updateId, this.now(), this.leaseMs);
    } catch (err: unknown) {
      // Fail-open: дедуп деградирует, сообщение НЕ теряется.
      logTelegramError({
        operation: "update_dedup_claim",
        error: err,
        detail: `update_id=${updateId}`,
      });
      return "ok";
    }
  }

  markDone(updateId: number): void {
    if (this.disabled) return;
    try {
      this.repo.markProcessedUpdateDone(updateId, this.now());
    } catch (err: unknown) {
      // Не критично: processing истечёт по lease, redelivery переиграет.
      logTelegramError({
        operation: "update_dedup_mark_done",
        error: err,
        detail: `update_id=${updateId}`,
      });
    }
  }
}
