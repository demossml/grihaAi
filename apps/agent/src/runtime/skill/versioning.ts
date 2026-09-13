/**
 * Phase 6 (Item 6.3, матрица F3) — версионирование скиллов.
 *
 * §14 master spec + урок Hermes #55647:
 * - LLM НИКОГДА не перезаписывает production skill напрямую;
 * - pipeline: current → proposed → diff → validation → evaluation →
 *   approve → new version;
 * - обязательные поля: version, parentVersion, diff, author, evaluation,
 *   rollback, active;
 * - если новая версия хуже — старая остаётся активной.
 *
 * Чистая in-memory реализация; персистентность — за флагом.
 */
import { diffChangeCount, diffLines, splitLines, type DiffOp } from "./diff.js";

export interface SkillEvaluation {
  score: number;
  passed: boolean;
  evaluatedAt: string;
}

export interface SkillVersion {
  version: number;
  parentVersion: number | null;
  /** Diff относительно parent-контента (у корня — пустой). */
  diff: DiffOp[];
  changeCount: number;
  author: string;
  createdAt: string;
  evaluation: SkillEvaluation | null;
  /** Версия, к которой откатываемся, если эта версия провалится. */
  rollbackVersion: number | null;
  active: boolean;
}

export interface SkillVersionStoreOptions {
  name: string;
  initialContent: string;
  author?: string;
  now?: () => string;
}

/** Применение diff-операций к старому тексту (same/remove потребляют старое). */
function applyOpsToOld(oldLines: string[], ops: readonly DiffOp[]): string[] {
  const out: string[] = [];
  let i = 0;
  for (const op of ops) {
    if (op.kind === "same") {
      out.push(op.line);
      i++;
    } else if (op.kind === "remove") {
      i++;
    } else {
      out.push(op.line);
    }
  }
  return out;
}

export class SkillVersionStore {
  readonly name: string;
  private readonly baseContent: string;
  private readonly versions: SkillVersion[] = [];
  private active: SkillVersion | null = null;
  private readonly now: () => string;

  constructor(options: SkillVersionStoreOptions) {
    this.name = options.name;
    this.now = options.now ?? (() => new Date().toISOString());
    if (options.initialContent.trim().length === 0) {
      throw new Error("validation: initial content must not be empty");
    }
    this.baseContent = options.initialContent;
    this.active = {
      version: 1,
      parentVersion: null,
      diff: [],
      changeCount: 0,
      author: options.author ?? "system",
      createdAt: this.now(),
      evaluation: null,
      rollbackVersion: null,
      active: true,
    };
    this.versions.push(this.active);
  }

  activeVersion(): SkillVersion | null {
    return this.active;
  }

  versionsList(): SkillVersion[] {
    return [...this.versions];
  }

  get(version: number): SkillVersion | undefined {
    return this.versions.find((v) => v.version === version);
  }

  /** Контент активной версии: base + диффы по пути от корня к активной. */
  content(): string {
    if (!this.active) return "";
    const path = this.pathTo(this.active);
    let lines = splitLines(this.baseContent);
    for (const v of path) {
      if (v.version === 1) continue; // корень — это baseContent
      lines = applyOpsToOld(lines, v.diff);
    }
    return lines.join("\n");
  }

  /**
   * Предлагает новую версию: активная НЕ меняется
   * (LLM не перезаписывает production напрямую).
   */
  propose(content: string, author: string): SkillVersion {
    if (content.trim().length === 0) {
      throw new Error("validation: content must not be empty");
    }
    const base = this.content();
    if (content === base) {
      throw new Error("validation: no changes vs active version");
    }
    const active = this.active!;
    const diff = diffLines(base, content);
    const version: SkillVersion = {
      version: this.versions.length + 1,
      parentVersion: active.version,
      diff,
      changeCount: diffChangeCount(diff),
      author,
      createdAt: this.now(),
      evaluation: null,
      rollbackVersion: null,
      active: false,
    };
    this.versions.push(version);
    return version;
  }

  /** Фиксирует оценку версии (не активирует). */
  evaluate(version: number, score: number, passThreshold: number): SkillEvaluation {
    const record = this.get(version);
    if (!record) throw new Error(`skill version not found: ${version}`);
    const evaluation: SkillEvaluation = {
      score,
      passed: score >= passThreshold,
      evaluatedAt: this.now(),
    };
    record.evaluation = evaluation;
    return evaluation;
  }

  /**
   * Approve: активация только если новая версия не хуже активной
   * (§14: «если новая версия хуже — старая остаётся активной»).
   */
  approveAndActivate(
    version: number,
  ): { activated: boolean; reason: string; version: SkillVersion | null } {
    const candidate = this.get(version);
    if (!candidate) {
      return { activated: false, reason: `skill version not found: ${version}`, version: null };
    }
    if (candidate.active) {
      return { activated: true, reason: "already active", version: candidate };
    }
    if (!candidate.evaluation) {
      return { activated: false, reason: "not evaluated yet", version: null };
    }
    if (!candidate.evaluation.passed) {
      return { activated: false, reason: "evaluation not passed", version: null };
    }
    const active = this.active;
    if (active?.evaluation && candidate.evaluation.score < active.evaluation.score) {
      return {
        activated: false,
        reason: `score ${candidate.evaluation.score} < active ${active.evaluation.score} — старая версия остаётся активной`,
        version: null,
      };
    }
    if (active) {
      active.active = false;
      candidate.rollbackVersion = active.version;
    }
    candidate.active = true;
    this.active = candidate;
    return { activated: true, reason: "activated", version: candidate };
  }

  /** Откат к предыдущей активной версии. */
  rollback(): { rolledBack: boolean; version: SkillVersion | null } {
    const active = this.active;
    if (!active || active.rollbackVersion === null) {
      return { rolledBack: false, version: null };
    }
    const target = this.get(active.rollbackVersion);
    if (!target) return { rolledBack: false, version: null };
    active.active = false;
    target.active = true;
    this.active = target;
    return { rolledBack: true, version: target };
  }

  /** Путь от корня (version 1) до целевой версии. */
  private pathTo(target: SkillVersion): SkillVersion[] {
    const path: SkillVersion[] = [];
    let current: SkillVersion | null = target;
    while (current) {
      path.unshift(current);
      current =
        current.parentVersion !== null
          ? this.versions.find((v) => v.version === current!.parentVersion) ?? null
          : null;
    }
    return path;
  }
}
