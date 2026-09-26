/**
 * L3 — диспетчер маршрутизации уроков review в handlers.
 *
 * `routeLesson` (routing.ts) даёт target; здесь — реальные handlers:
 *   factual    → memory   (MemoryEngine.remember, lesson)
 *   preference → user-model (UserModelStore.observe, candidate preference)
 *   procedural → skill   (SkillCandidateStore — ТОЛЬКО evidence, без proposal)
 *
 * Skill-branch НЕ вызывает applySkillProposal и НЕ пишет SKILL.md — только
 * накапливает candidate evidence (proposal/gate — в L4).
 *
 * Ни один handler не бросает наружу: ошибки → "error", unknown/drop → "drop".
 */
import { InMemoryMemoryStore } from "../memory/store.js";
import type { MemoryEngine } from "../memory/types.js";
import { UserModelStore } from "./user-model.js";
import { routeLesson } from "./routing.js";

export type LessonTarget = "memory" | "skill" | "user-model" | "drop";

export interface RoutedLesson {
  content: string;
  source?: string;
}

export interface SkillCandidateEvidence {
  content: string;
  source: string;
  createdAt: string;
  /** Опционально — для per-skill дедупа предложений (L4). */
  skillId?: string;
}

/** L3: candidate evidence только; threshold + proposal — в L4. */
export class SkillCandidateStore {
  private readonly items: SkillCandidateEvidence[] = [];
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  add(content: string, source: string, skillId?: string): SkillCandidateEvidence {
    const evidence: SkillCandidateEvidence = {
      content,
      source,
      createdAt: this.now(),
      skillId,
    };
    this.items.push(evidence);
    return evidence;
  }

  list(): SkillCandidateEvidence[] {
    return [...this.items];
  }

  count(): number {
    return this.items.length;
  }
}

export interface LessonRouteCtx {
  userId?: string;
  turnId?: string;
  memory: MemoryEngine;
  userModel: UserModelStore;
  skillCandidates: SkillCandidateStore;
}

export type ApplyLessonRouteResult = "ok" | "drop" | "error";

export async function applyLessonRoute(
  route: { target: LessonTarget; kind?: string },
  lesson: RoutedLesson,
  ctx: LessonRouteCtx,
): Promise<ApplyLessonRouteResult> {
  switch (route.target) {
    case "drop":
      return "drop";
    case "memory":
      return memoryHandler(lesson, ctx);
    case "user-model":
      return userModelHandler(lesson, ctx);
    case "skill":
      return skillCandidateHandler(lesson, ctx);
    default:
      return "drop";
  }
}

async function memoryHandler(lesson: RoutedLesson, ctx: LessonRouteCtx): Promise<"ok" | "error"> {
  try {
    const source = lesson.source ?? "background-review";
    await ctx.memory.remember({
      type: "lesson",
      content: lesson.content,
      source,
      confidence: 0.5,
      provenance: source,
    });
    return "ok";
  } catch {
    return "error";
  }
}

async function userModelHandler(lesson: RoutedLesson, ctx: LessonRouteCtx): Promise<"ok" | "error"> {
  try {
    // candidate preference (delta 0.5 ≥ candidateThreshold 0.3, < confirmThreshold 0.7)
    // — не «жёстко» форсим, просто накапливаем evidence.
    ctx.userModel.observe("preference", lesson.content, lesson.source ?? "background-review", 0.5);
    return "ok";
  } catch {
    return "error";
  }
}

async function skillCandidateHandler(
  lesson: RoutedLesson,
  ctx: LessonRouteCtx,
): Promise<"ok" | "error"> {
  try {
    ctx.skillCandidates.add(lesson.content, lesson.source ?? "background-review");
    return "ok";
  } catch {
    return "error";
  }
}

let memorySingleton: InMemoryMemoryStore | null = null;
let userModelSingleton: UserModelStore | null = null;
let skillCandidateSingleton: SkillCandidateStore | null = null;

/** Process-wide ctx (in-memory stores; durable-слой — вне scope L3). */
export function getLessonRouteCtx(userId?: string, turnId?: string): LessonRouteCtx {
  if (!memorySingleton) memorySingleton = new InMemoryMemoryStore();
  if (!userModelSingleton) userModelSingleton = new UserModelStore();
  if (!skillCandidateSingleton) skillCandidateSingleton = new SkillCandidateStore();
  return {
    userId,
    turnId,
    memory: memorySingleton,
    userModel: userModelSingleton,
    skillCandidates: skillCandidateSingleton,
  };
}

/** Process-wide store накопленного procedural-evidence (L4 гейт). */
export function getSkillCandidateStore(): SkillCandidateStore {
  if (!skillCandidateSingleton) skillCandidateSingleton = new SkillCandidateStore();
  return skillCandidateSingleton;
}

export interface RouteLessonsOutcome {
  routed: number;
  dropped: number;
  errors: number;
}

/** Прогоняет список уроков review через routeLesson → applyLessonRoute. */
export async function routeBackgroundLessons(
  lessons: ReadonlyArray<{ content: string; kind?: string }>,
  ctx: LessonRouteCtx = getLessonRouteCtx(),
): Promise<RouteLessonsOutcome> {
  const outcome: RouteLessonsOutcome = { routed: 0, dropped: 0, errors: 0 };
  for (const lesson of lessons) {
    if (!lesson || typeof lesson.content !== "string" || !lesson.content.trim()) continue;
    const route = routeLesson({ content: lesson.content, source: "background-review" });
    const result = await applyLessonRoute(
      route,
      { content: lesson.content, source: "background-review" },
      ctx,
    );
    if (result === "ok") outcome.routed++;
    else if (result === "drop") outcome.dropped++;
    else outcome.errors++;
  }
  return outcome;
}
