/**
 * L1 — durable turn-level experience store (idempotent by turnId).
 *
 * Один turn = одна запись experience. Append-only JSONL под
 * `~/.grish-ai/learning/experiences.jsonl` (переопределяется `GRISH_AI_HOME`
 * и опцией `filePath`). Без LLM, без skill proposals — только факт хода.
 *
 * Отличие от `experience.ts` (G3/G4): тот store — in-memory, про
 * task/tools/errors/result/eval/lesson и противоречия; этот — durable
 * «одна строка на ход» с идемпотентностью по `turnId`.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getConfigDir } from "@griha/config";

export interface TurnExperienceRecord {
  id: string;
  turnId: string;
  task: string;
  result?: string;
  success: boolean;
  error?: string;
  toolsUsed?: string[];
  skillId?: string;
  userId?: string;
  sessionKey?: string;
  createdAt: string;
}

export type TurnExperienceInput = Omit<TurnExperienceRecord, "id" | "createdAt">;

export interface TurnExperienceStoreOptions {
  /** JSONL-путь; default `~/.grish-ai/learning/experiences.jsonl`. */
  filePath?: string;
  idFactory?: () => string;
  now?: () => string;
}

export function defaultExperiencePath(): string {
  return path.join(getConfigDir(), "learning", "experiences.jsonl");
}

export class TurnExperienceStore {
  private readonly filePath: string;
  private readonly idFactory: () => string;
  private readonly now: () => string;
  private readonly byTurn = new Map<string, TurnExperienceRecord>();

  constructor(options: TurnExperienceStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultExperiencePath();
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.load();
  }

  /** Поднимает уже записанные turnId из файла (идемпотентность после рестарта). */
  private load(): void {
    let raw = "";
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return; // файла ещё нет
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed) as TurnExperienceRecord;
        if (rec && typeof rec.turnId === "string" && rec.turnId) {
          this.byTurn.set(rec.turnId, rec);
        }
      } catch {
        // повреждённая строка — пропускаем
      }
    }
  }

  private append(rec: TurnExperienceRecord): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, JSON.stringify(rec) + "\n", "utf8");
    } catch {
      // durability best-effort: in-memory запись уже есть, не роняем ход
    }
  }

  hasTurn(turnId: string): boolean {
    return this.byTurn.has(turnId);
  }

  getByTurn(turnId: string): TurnExperienceRecord | undefined {
    const rec = this.byTurn.get(turnId);
    return rec ? { ...rec } : undefined;
  }

  /** Идемпотентно: повторный turnId возвращает существующую запись, не дублируя. */
  record(input: TurnExperienceInput & { id?: string }): TurnExperienceRecord {
    const existing = this.byTurn.get(input.turnId);
    if (existing) return { ...existing };
    const record: TurnExperienceRecord = {
      id: input.id ?? this.idFactory(),
      turnId: input.turnId,
      task: input.task,
      result: input.result,
      success: input.success,
      error: input.error,
      toolsUsed: input.toolsUsed,
      skillId: input.skillId,
      userId: input.userId,
      sessionKey: input.sessionKey,
      createdAt: this.now(),
    };
    this.byTurn.set(input.turnId, record);
    this.append(record);
    return { ...record };
  }
}

let singleton: TurnExperienceStore | null = null;

/** Process-wide store (по умолчанию — durable JSONL). */
export function getTurnExperienceStore(): TurnExperienceStore {
  if (!singleton) singleton = new TurnExperienceStore();
  return singleton;
}
