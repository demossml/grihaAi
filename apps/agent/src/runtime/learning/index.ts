/**
 * Phase 7 — Learning / Experience публичный API (чистые функции).
 * Ничего не подключено к production-путям.
 */
export {
  classifyLesson,
  routeLesson,
  type Lesson,
  type LessonKind,
  type LessonRoute,
} from "./routing.js";
export {
  ExperienceStore,
  type ExperienceInput,
  type ExperienceQuery,
  type ExperienceRecord,
} from "./experience.js";
export {
  TurnExperienceStore,
  defaultExperiencePath,
  getTurnExperienceStore,
  type TurnExperienceInput,
  type TurnExperienceRecord,
  type TurnExperienceStoreOptions,
} from "./turn-experience.js";
export {
  recordTurnExperience,
  type RecordTurnExperienceResult,
} from "./record-turn-experience.js";
export {
  UserModelStore,
  type UserInsight,
  type UserInsightCategory,
  type UserInsightStatus,
  type UserModelStoreOptions,
} from "./user-model.js";
export {
  DEFAULT_QUALITY_OPTIONS,
  SkillQualityTracker,
  type QualityTrackerOptions,
  type SkillOutcome,
  type SkillQuality,
} from "./quality.js";
export {
  DEFAULT_BACKGROUND_REVIEW_POLICY,
  shouldBackgroundReview,
  type BackgroundReviewDecision,
  type BackgroundReviewPolicy,
  type BackgroundReviewResult,
  type TurnInfo,
} from "./background.js";
