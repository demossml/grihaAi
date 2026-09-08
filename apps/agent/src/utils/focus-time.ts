/**
 * Focus-time protection — pure analysis of a day's calendar for meeting
 * density, fragmented days and protected focus blocks. Never mutates the
 * calendar; it only suggests alternatives.
 */

export interface TimedBlock {
  startMinutes: number;
  endMinutes: number;
  title: string;
}

export interface DayAnalysis {
  busyMinutes: number;
  density: number;
  /** Gaps shorter than this are "fragmentation". */
  fragmentedGaps: number;
  /** Free gaps of at least this length — candidates for protected focus. */
  focusBlocks: Array<{ startMinutes: number; endMinutes: number }>;
  /** Total free minutes. */
  freeMinutes: number;
}

const FRAGMENT_THRESHOLD_MIN = 30;
const FOCUS_BLOCK_MIN = 120;

export function analyzeDay(
  blocks: TimedBlock[],
  dayStartMinutes = 9 * 60,
  dayEndMinutes = 18 * 60,
): DayAnalysis {
  const sorted = [...blocks]
    .filter((b) => b.endMinutes > dayStartMinutes && b.startMinutes < dayEndMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  let busy = 0;
  let fragmentedGaps = 0;
  let free = 0;
  const focusBlocks: DayAnalysis["focusBlocks"] = [];

  let cursor = dayStartMinutes;
  for (const block of sorted) {
    const start = Math.max(block.startMinutes, dayStartMinutes);
    const end = Math.min(block.endMinutes, dayEndMinutes);
    if (end <= start) continue;
    if (start > cursor) {
      const gap = start - cursor;
      if (gap < FRAGMENT_THRESHOLD_MIN) fragmentedGaps++;
      if (gap >= FOCUS_BLOCK_MIN) focusBlocks.push({ startMinutes: cursor, endMinutes: start });
      free += gap;
    }
    busy += end - Math.max(start, cursor);
    cursor = Math.max(cursor, end);
  }
  if (cursor < dayEndMinutes) {
    const tail = dayEndMinutes - cursor;
    if (tail < FRAGMENT_THRESHOLD_MIN) fragmentedGaps++;
    if (tail >= FOCUS_BLOCK_MIN) focusBlocks.push({ startMinutes: cursor, endMinutes: dayEndMinutes });
    free += tail;
  }

  const total = dayEndMinutes - dayStartMinutes;
  return {
    busyMinutes: busy,
    density: total > 0 ? busy / total : 0,
    fragmentedGaps,
    focusBlocks,
    freeMinutes: free,
  };
}

export interface ConflictSuggestion {
  conflicts: boolean;
  message?: string;
  alternativeStartMinutes?: number;
}

/**
 * Suggest a non-fragmenting slot when a new meeting overlaps or splits a long
 * focus block. Returns null-suggestion (conflicts=false) when the day is clear.
 */
export function suggestAlternative(
  blocks: TimedBlock[],
  newBlock: TimedBlock,
  dayStartMinutes = 9 * 60,
  dayEndMinutes = 18 * 60,
): ConflictSuggestion {
  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
  const overlaps = sorted.some(
    (b) => newBlock.startMinutes < b.endMinutes && newBlock.endMinutes > b.startMinutes,
  );

  if (!overlaps) return { conflicts: false };

  // Find the first free gap that fits the new block.
  const analysis = analyzeDay(blocks, dayStartMinutes, dayEndMinutes);
  for (const fb of analysis.focusBlocks) {
    if (fb.endMinutes - fb.startMinutes >= newBlock.endMinutes - newBlock.startMinutes) {
      return {
        conflicts: true,
        alternativeStartMinutes: fb.startMinutes,
        message: `Время занято; предложи ${minutesToClock(fb.startMinutes)} — есть свободный блок.`,
      };
    }
  }
  return { conflicts: true, message: "День плотный, свободного блока нет." };
}

export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
