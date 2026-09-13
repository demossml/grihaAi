/**
 * Phase 7 (Item 7.1, матрица G2) — маршрутизация уроков.
 *
 * Hermes: factual → memory, procedural → skill, preference → user model.
 * Детерминированная классификация по маркерам; чистая функция.
 */

export type LessonKind = "factual" | "procedural" | "preference" | "unknown";

export interface Lesson {
  content: string;
  source: string;
}

export interface LessonRoute {
  kind: LessonKind;
  target: "memory" | "skill" | "user-model" | "drop";
}

const B = String.raw`(^|[\s.,!?;:()\-])`;
const E = String.raw`(?=$|[\s.,!?;:()\-])`;
const PROCEDURAL_MARKERS = new RegExp(
  B + String.raw`(всегда|каждый раз|процедура|порядок|шаги|сначала|потом|затем|how to|steps?|procedure|workflow)` + E,
  "i",
);
const PREFERENCE_MARKERS = new RegExp(
  B + String.raw`(предпочита[^\s.,!?;:()\-]*|нравится|любит|люблю|не люблю|не любит|хочет|не хочет|prefers?|likes?|wants?|dislikes?)` + E,
  "i",
);
const FACTUAL_MARKERS = new RegExp(
  B + String.raw`(факт|адрес|телефон|почта|email|имя|дата рождения|компания|должность|fact|address|phone|name|company)` + E,
  "i",
);

/** Классификация урока (первый сработавший маркер, приоритет preference → procedural → factual). */
export function classifyLesson(lesson: Lesson): LessonKind {
  if (PREFERENCE_MARKERS.test(lesson.content)) return "preference";
  if (PROCEDURAL_MARKERS.test(lesson.content)) return "procedural";
  if (FACTUAL_MARKERS.test(lesson.content)) return "factual";
  return "unknown";
}

/** Маршрутизация урока в целевой store. unknown → drop. */
export function routeLesson(lesson: Lesson): LessonRoute {
  const kind = classifyLesson(lesson);
  switch (kind) {
    case "factual":
      return { kind, target: "memory" };
    case "procedural":
      return { kind, target: "skill" };
    case "preference":
      return { kind, target: "user-model" };
    default:
      return { kind, target: "drop" };
  }
}
