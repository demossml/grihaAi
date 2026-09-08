import type { TranscribeResult } from "@griha/shared-types";

/**
 * Voice intake — deterministic transcript confidence assessment.
 *
 * The local STT backend does not expose acoustic confidence, so this is a
 * conservative heuristic gate: when the transcript is empty, too short or
 * garbled, the agent must re-ask instead of guessing. Critical numbers,
 * dates, names and amounts must never be inferred from an uncertain
 * transcript.
 */

export interface TranscriptAssessment {
  /** 0..1 */
  confidence: number;
  uncertain: boolean;
  reason?: string;
}

const GARBAGE_RATIO_THRESHOLD = 0.35;

function isGarbageChar(ch: string): boolean {
  if (/\s/.test(ch)) return false;
  if (/[\p{L}\p{N}]/u.test(ch)) return false;
  if (/[.,!?;:\-—()"'%€$₽№/&+#@]/u.test(ch)) return false;
  return true;
}

export function assessTranscriptConfidence(result: TranscribeResult): TranscriptAssessment {
  if (!result.ok) {
    return { confidence: 0, uncertain: true, reason: result.error ?? "STT failed" };
  }
  const text = result.text?.trim() ?? "";
  if (text.length === 0) {
    return { confidence: 0, uncertain: true, reason: "empty transcript" };
  }
  if (text.length < 3) {
    return { confidence: 0.3, uncertain: true, reason: "transcript too short" };
  }

  let garbage = 0;
  for (const ch of text) {
    if (isGarbageChar(ch)) garbage++;
  }
  const ratio = garbage / text.length;
  if (ratio > GARBAGE_RATIO_THRESHOLD) {
    return { confidence: 0.4, uncertain: true, reason: "transcript looks garbled" };
  }

  return { confidence: 0.9, uncertain: false };
}
