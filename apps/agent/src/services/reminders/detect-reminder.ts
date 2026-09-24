/**
 * S2/R6 — узкий детектор явных напоминаний из входящего текста (без LLM, без NLP).
 *
 * Требует маркер («напомни», «созвон», «встреч», «звонок», «дедлайн», «срок»).
 * Время:
 *   - «через N минут/часов» → confidence 0.4 (needs_confirmation), от now;
 *   - «в 14:00» (clock) → date+time → confidence 0.9;
 *   - «завтра»/«послезавтра» (date only) → confidence 0.7, default 09:00.
 *
 * Timezone: project default = Europe/Moscow (UTC+3, фиксировано, без DST для v1).
 * dueAt возвращается как UTC-Instant, соответствующий локальному времени Москвы.
 */
export interface DetectedReminder {
  text: string;
  /** UTC Instant (Moscow-локальное время сдвинуто на −3ч). */
  dueAt: Date;
  confidence: number;
}

const TRIGGERS = ["напомни", "созвон", "встреч", "звонок", "дедлайн", "срок"];
const CLOCK_RE = /(?:в\s+)?(\d{1,2})[:.](\d{2})/;
// Без \b: JS \b не матчит кириллицу (не ASCII \w).
const IN_MIN_RE = /через\s+(\d{1,3})\s*(минут|мин|час|часов|ч)/i;

/** Фиксированный offset Москвы (UTC+3), без DST (v1). */
const MSK_OFFSET_MIN = 180;
const MSK_OFFSET_MS = MSK_OFFSET_MIN * 60_000;

function mskDate(now: Date): Date {
  return new Date(now.getTime() + MSK_OFFSET_MS);
}

export function detectExplicitReminder(input: {
  text: string;
  now?: Date;
}): DetectedReminder | null {
  const text = input.text.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (!TRIGGERS.some((t) => lower.includes(t))) return null;

  const now = input.now ?? new Date();

  // 1) Относительное «через N минут/часов» → 0.4 (needs_confirmation), hard anchor от now.
  const rel = IN_MIN_RE.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    if (Number.isFinite(n) && n > 0) {
      const ms = unit.startsWith("час") ? n * 3_600_000 : n * 60_000;
      return { text, dueAt: new Date(now.getTime() + ms), confidence: 0.4 };
    }
  }

  // 2) Абсолютное время (clock) либо дата.
  const m = CLOCK_RE.exec(text);
  const hour = m ? Number(m[1]) : undefined;
  const minute = m ? Number(m[2]) : undefined;
  if (hour !== undefined && (hour > 23 || (minute ?? 0) > 59)) return null;

  let dayOffset = 0;
  if (lower.includes("послезавтра")) dayOffset = 2;
  else if (lower.includes("завтра")) dayOffset = 1;

  // Без явного времени и без даты → null (не знаем когда).
  if (hour === undefined && dayOffset === 0) return null;

  // «Сегодня» в Москве.
  const msk = mskDate(now);
  const mskYear = msk.getUTCFullYear();
  const mskMonth = msk.getUTCMonth();
  const mskDay = msk.getUTCDate();

  // dueAt как Moscow-локальное время (в UTC-полях), затем −3ч → UTC Instant.
  const dueMsk =
    hour !== undefined
      ? new Date(Date.UTC(mskYear, mskMonth, mskDay + dayOffset, hour, minute ?? 0, 0, 0))
      : new Date(Date.UTC(mskYear, mskMonth, mskDay + dayOffset, 9, 0, 0, 0));
  const dueAt = new Date(dueMsk.getTime() - MSK_OFFSET_MS);

  // Без явного дня и время уже прошло → не угадываем (null).
  if (dayOffset === 0 && dueAt.getTime() <= now.getTime()) return null;

  const confidence = hour !== undefined ? 0.9 : 0.7;

  return { text, dueAt, confidence };
}
