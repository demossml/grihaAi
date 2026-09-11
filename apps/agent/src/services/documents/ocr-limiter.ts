/**
 * G3 — контроль стоимости OCR/vision.
 * Per-chat скользящее окно (in-process) + гейты размера/подсказок.
 */
import type { ChatPolicy } from "../../../.pi/extensions/user-rules/chat-policy.js";

export const DEFAULT_MAX_OCR_PER_HOUR = 60;

export class OcrRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly defaultMaxPerHour: number = DEFAULT_MAX_OCR_PER_HOUR) {}

  /** Разрешён ли OCR-вызов для чата (скользящее окно часа). */
  allow(chatId: string, maxPerHour?: number): boolean {
    const max = maxPerHour ?? this.defaultMaxPerHour;
    if (max <= 0) return false;
    const now = Date.now();
    const window = (this.windows.get(chatId) ?? []).filter((t) => now - t < 3_600_000);
    if (window.length >= max) {
      this.windows.set(chatId, window);
      return false;
    }
    window.push(now);
    this.windows.set(chatId, window);
    return true;
  }

  remaining(chatId: string, maxPerHour?: number): number {
    const max = maxPerHour ?? this.defaultMaxPerHour;
    const now = Date.now();
    const window = (this.windows.get(chatId) ?? []).filter((t) => now - t < 3_600_000);
    return Math.max(0, max - window.length);
  }
}

const singleton = new OcrRateLimiter();
export function getOcrRateLimiter(): OcrRateLimiter {
  return singleton;
}

export interface OcrGateInput {
  sizeBytes?: number;
  caption?: string;
  policy?: Pick<ChatPolicy["processing"], "minFileSizeBytes" | "maxFileSizeBytes" | "skipIfNoDocumentHint">;
}

export interface OcrGateResult {
  ok: boolean;
  reason?: string;
}

const DOCUMENT_HINT = /(чек|накладн|счёт|счет|invoice|receipt|сумм|итого|оплачено|расход)/i;

/**
 * Гейты перед vision-вызовом: размер файла + эвристика «похоже на документ».
 * Не документ (мем/скрин) при skipIfNoDocumentHint — OCR не гоняем.
 */
export function ocrSizeAndHintGate(input: OcrGateInput): OcrGateResult {
  const p = input.policy;
  if (!p) return { ok: true };
  if (p.minFileSizeBytes !== undefined && input.sizeBytes !== undefined) {
    if (input.sizeBytes < p.minFileSizeBytes) {
      return { ok: false, reason: `file below min ${p.minFileSizeBytes} bytes` };
    }
  }
  if (p.maxFileSizeBytes !== undefined && input.sizeBytes !== undefined) {
    if (input.sizeBytes > p.maxFileSizeBytes) {
      return { ok: false, reason: `file above max ${p.maxFileSizeBytes} bytes` };
    }
  }
  if (p.skipIfNoDocumentHint && !DOCUMENT_HINT.test(input.caption ?? "")) {
    return { ok: false, reason: "no document hint in caption" };
  }
  return { ok: true };
}
