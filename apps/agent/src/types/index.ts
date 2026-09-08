import { Type, type Static } from "typebox";

export type AgentId = string;
export type ProjectId = string;
export type SessionId = string;
export type BotId = string;

/** Durable fact */
export interface MemoryFact {
  id: string;
  content: string;
  category: "preference" | "fact" | "procedure" | "insight" | "user_profile" | "decision" | "other";
  projectId?: ProjectId;
  agentId?: AgentId;
  botId?: BotId;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  /** Vector embedding produced by the embedding service. */
  embedding?: number[] | Float32Array | Buffer;
}

/** Session message for FTS5 cross-session recall */
export interface SessionMessage {
  id: string;
  sessionId: SessionId;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: unknown[];
  createdAt: string;
  agentId?: AgentId;
  botId?: BotId;
  projectId?: ProjectId;
}

/** Named specialist Bot */
export interface BotConfig {
  id: BotId;
  name: string;
  systemPrompt: string;
  parentId?: BotId;
  projectId?: ProjectId;
  model?: string;
  provider?: string;
  tools?: string[] | null;
  criticalRules?: string[];
  avatarSeed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: ProjectId;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  source: "vector" | "fts" | "hybrid";
  metadata?: Record<string, unknown>;
}

export const MemoryAddSchema = Type.Object({
  content: Type.String({ minLength: 1 }),
  category: Type.Union([
    Type.Literal("preference"), Type.Literal("fact"), Type.Literal("procedure"),
    Type.Literal("insight"), Type.Literal("user_profile"), Type.Literal("decision"),
    Type.Literal("other"),
  ]),
  projectId: Type.Optional(Type.String()),
  botId: Type.Optional(Type.String()),
});
export type MemoryAddParams = Static<typeof MemoryAddSchema>;

export const MemorySearchSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
  projectId: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  botId: Type.Optional(Type.String()),
});
export type MemorySearchParams = Static<typeof MemorySearchSchema>;

/** Phase 5 — Smart Delegation */

export type TaskComplexity = "simple" | "complex";

export type SubAgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "steered"
  | "stopped";

export interface SubAgentTask {
  id: string;
  goal: string;
  context?: string;
  role?: string;
  status: SubAgentStatus;
  result?: string;
  parentSessionId: string;
  /** Isolated subtree memory for this sub-agent. */
  subtreeSessionId: string;
  createdAt: string;
  finishedAt?: string;
}

export interface SharedInsight {
  id: string;
  content: string;
  sourceBotId?: string;
  sourceTaskId?: string;
  projectId?: string;
  createdAt: string;
  tags?: string[];
}

export interface DelegationPlan {
  complexity: TaskComplexity;
  reason: string;
  tasks: Array<{
    goal: string;
    context?: string;
    role?: string;
  }>;
}

/** Phase 6 — Live Steering */

export interface SubAgentState {
  taskId: string;
  subtreeSessionId: string;
  goal: string;
  role?: string;
  status: SubAgentStatus;
  startedAt: string;
  lastUpdateAt: string;
  partialResult?: string;
  finalResult?: string;
  steeringMessages?: string[];
  parentSessionId: string;
}

export interface SteerCommand {
  taskId: string;
  message: string;
  action: "continue" | "redirect" | "stop";
}

/** Phase 7 — Cron with Memory & Continuity */

export interface CronJob {
  id: string;
  name: string;
  /** Cron expression or human-readable schedule ("every day at 9:00"). */
  schedule: string;
  prompt: string;
  enabled: boolean;
  /** Pass previous result + notepad into the next run. */
  continuity: boolean;
  /** Skip the LLM call when nothing changed. */
  monitorMode: boolean;
  lastRunAt?: string;
  lastResult?: string;
  /** Durable scratchpad. */
  notepad?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CronRunRecord {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: "success" | "skipped" | "failed";
  result?: string;
  usedLlm: boolean;
}

/** Phase 9 — Continuous Personal Learning */

export interface UserProfile {
  /** "owner" | telegram user id | etc. */
  userId: string;
  displayName?: string;
  role?: string;
  timezone?: string;
  language?: string;
  communicationStyle?: string;
  preferences: Record<string, string>;
  updatedAt: string;
}

export interface ClientNote {
  id: string;
  userId: string;
  content: string;
  category: "preference" | "procedure" | "style" | "other";
  createdAt: string;
  updatedAt: string;
  source?: "auto" | "manual";
}

/** Phase 11 — User Rules (domain types live in @griha/shared-types). */

export const RulesAddSchema = Type.Object({
  scope: Type.Union([Type.Literal("global"), Type.Literal("chat")]),
  chatId: Type.Optional(Type.String()),
  text: Type.String({ minLength: 1 }),
  kind: Type.Optional(Type.Union([Type.Literal("hard"), Type.Literal("soft")])),
  ownerUserId: Type.Optional(Type.String()),
});
export type RulesAddParams = Static<typeof RulesAddSchema>;

export const RulesListSchema = Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("chat")])),
  chatId: Type.Optional(Type.String()),
  enabledOnly: Type.Optional(Type.Boolean()),
});
export type RulesListParams = Static<typeof RulesListSchema>;

export const RulesEditSchema = Type.Object({
  id: Type.String(),
  text: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  kind: Type.Optional(Type.Union([Type.Literal("hard"), Type.Literal("soft")])),
});
export type RulesEditParams = Static<typeof RulesEditSchema>;

export const RulesDeleteSchema = Type.Object({ id: Type.String() });
export type RulesDeleteParams = Static<typeof RulesDeleteSchema>;

export const RulesGetSchema = Type.Object({ id: Type.String() });
export type RulesGetParams = Static<typeof RulesGetSchema>;
