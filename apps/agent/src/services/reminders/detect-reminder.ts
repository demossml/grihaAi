/**
 * S2 — узкий детектор явных напоминаний из входящего текста (без LLM, без NLP).
 *
 * Требует И маркер («напомни», «созвон», «встречу» …), И явное время вида
 * «14:00» / «в 15:00». Без абсолютного времени → null (не угадываем).
 * Относительные сроки («через 5 минут») НЕ детектятся (null).
 *
 * confidence: 0.9 при «напомни», иначе 0.7 — всегда >= 0.5 (pending).
 */
export interface DetectedReminder {
  text: string;
  dueAt: Date;
  /** 0..1; при успешном детекте всегда >= 0.5 (явное время). */
  confidence: number;
}

const TRIGGERS = ["напомни", "созвон", "встречу", "встреча", "звонок", "дедлайн", "срок"];
const CLOCK_RE = /(?:в\s+)?(\d{1,2})[:.](\d{2})/;

export function detectExplicitReminder(input: {
  text: string;
  now?: Date;
}): DetectedReminder | null {
  const text = input.text.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (!TRIGGERS.some((t) => lower.includes(t))) return null;

  const m = CLOCK_RE.exec(text);
  if (!m) return null;

  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;

  const now = input.now ?? new Date();
  let dayOffset = 0;
  if (lower.includes("послезавтра")) dayOffset = 2;
  else if (lower.includes("завтра")) dayOffset = 1;
  else if (lower.includes("сегодня")) dayOffset = 0;

  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + dayOffset);
  dueAt.setHours(hour, minute, 0, 0);

  // Время уже прошло сегодня и день не указан явно → не угадываем (null).
  if (dayOffset === 0 && dueAt.getTime() <= now.getTime()) return null;

  const confidence = lower.includes("напомни") ? 0.9 : 0.7;

  return { text, dueAt, confidence };
}
