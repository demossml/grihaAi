/**
 * L2 — подключение SkillQualityTracker к execution: success/fail сигналы.
 *
 * `SkillQualityTracker` (quality.ts) — чистый in-memory трекер. Здесь —
 * синглтон с best-effort JSONL-персистентностью (`~/.grish-ai/learning/
 * quality.jsonl`) и чистая orchestration-функция для wiring.
 *
 * Durability в L2 — минимальная (append-only JSONL, переживает рестарт по
 * count/success; точная таймлайн не сохраняется — для regression-окна L5
 * достаточно in-process состояния).
 */
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "@griha/config";
import { SkillQualityTracker } from "./quality.js";

export interface QualityOutcomeLine {
  skillId: string;
  success: boolean;
  atMs: number;
}

export function qualityPath(): string {
  return path.join(getConfigDir(), "learning", "quality.jsonl");
}

function appendLine(line: QualityOutcomeLine): void {
  try {
    fs.mkdirSync(path.dirname(qualityPath()), { recursive: true });
    fs.appendFileSync(qualityPath(), JSON.stringify(line) + "\n", "utf8");
  } catch {
    // best-effort: in-memory state уже обновлён
  }
}

let singleton: SkillQualityTracker | null = null;

/** Process-wide трекер: поднимает прошлые outcomes из JSONL (best-effort). */
export function getQualityTracker(): SkillQualityTracker {
  if (!singleton) {
    singleton = new SkillQualityTracker();
    let raw = "";
    try {
      raw = fs.readFileSync(qualityPath(), "utf8");
    } catch {
      // файла ещё нет
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const o = JSON.parse(trimmed) as QualityOutcomeLine;
        if (o && typeof o.skillId === "string" && o.skillId) {
          singleton.recordOutcome(o.skillId, o.success === true, o.atMs);
        }
      } catch {
        // повреждённая строка — пропускаем
      }
    }
  }
  return singleton;
}

/**
 * Чистая orchestration: записывает outcome для каждого непустого skillId.
 * Ошибки изолированы — один «плохой» skillId не останавливает остальные и
 * не роняет ход. Пустой/неизвестный skillId пропускается (не выдумываем id).
 */
export function recordSkillOutcomes(
  tracker: SkillQualityTracker,
  skillIds: readonly (string | undefined)[],
  success: boolean,
  atMs: number = Date.now(),
): { recorded: number } {
  let recorded = 0;
  for (const skillId of skillIds) {
    if (!skillId) continue;
    try {
      tracker.recordOutcome(skillId, success, atMs);
      recorded++;
    } catch {
      // isolate
    }
  }
  return { recorded };
}

/** Durable-обёртка поверх синглтона: record + append в JSONL. */
export function recordTurnSkillOutcomes(
  skillIds: readonly (string | undefined)[],
  success: boolean,
  atMs: number = Date.now(),
): { recorded: number } {
  const result = recordSkillOutcomes(getQualityTracker(), skillIds, success, atMs);
  for (const skillId of skillIds) {
    if (!skillId) continue;
    appendLine({ skillId, success, atMs });
  }
  return result;
}
