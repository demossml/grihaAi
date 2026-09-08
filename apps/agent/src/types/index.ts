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
  /** Snapshot of the monitorable state captured at the last successful run (monitorMode). */
  stateSnapshot?: string;
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

/** Phase 16 — Foundation: approvals + commitments */

export type ApprovalActionClass =
  | "READ_ONLY"
  | "REVERSIBLE_LOW_RISK"
  | "SIDE_EFFECT"
  | "HIGH_RISK_IRREVERSIBLE";

export interface FinancialApprovalPolicy {
  currency: string;
  autoApproveBelow?: number;
  alwaysConfirmAbove?: number;
  categoriesAlwaysConfirm?: string[];
}

export interface ApprovalPolicyRecord {
  id: string;
  userId: string;
  scope: "global" | "chat";
  chatId?: string;
  financial?: FinancialApprovalPolicy;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalStatus = "pending" | "granted" | "denied" | "expired";

export interface ApprovalRequestRecord {
  id: string;
  userId: string;
  sessionId: string;
  action: string;
  actionClass: ApprovalActionClass;
  target?: string;
  args?: Record<string, unknown>;
  status: ApprovalStatus;
  expiresAt?: string;
  createdAt: string;
  resolvedAt?: string;
}

export type CommitmentStatus = "open" | "due_soon" | "overdue" | "completed" | "cancelled";

export interface Commitment {
  id: string;
  userId: string;
  /** Human-readable description of the obligation. */
  text: string;
  /** What must be done (canonical domain field; alias of text). */
  action?: string;
  /** Who is responsible. */
  who?: string;
  /** Who is responsible (canonical domain field; alias of who). */
  actor?: string;
  /** To whom it is owed / for whom. */
  toWhom?: string;
  /** To whom / about what (canonical domain field; alias of toWhom). */
  target?: string;
  /** ISO timestamp. */
  dueDate?: string;
  /** ISO timestamp (canonical domain field; alias of dueDate). */
  deadline?: string;
  status: CommitmentStatus;
  sourceType?: "message" | "meeting" | "voice" | "manual";
  source?: string;
  sourceId?: string;
  sourceMessageId?: string;
  contactId?: string;
  meetingId?: string;
  /** 0..1 extraction confidence. */
  confidence: number;
  provenance?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const ApprovalPolicySetSchema = Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("chat")])),
  chatId: Type.Optional(Type.String()),
  financial: Type.Object({
    currency: Type.String({ minLength: 1 }),
    autoApproveBelow: Type.Optional(Type.Number()),
    alwaysConfirmAbove: Type.Optional(Type.Number()),
    categoriesAlwaysConfirm: Type.Optional(Type.Array(Type.String())),
  }),
});
export type ApprovalPolicySetParams = Static<typeof ApprovalPolicySetSchema>;

export const ApprovalRequestSchema = Type.Object({
  action: Type.String({ minLength: 1 }),
  target: Type.Optional(Type.String()),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type ApprovalRequestParams = Static<typeof ApprovalRequestSchema>;

export const ApprovalGrantSchema = Type.Object({ id: Type.String() });
export type ApprovalGrantParams = Static<typeof ApprovalGrantSchema>;

export const CommitmentAddSchema = Type.Object({
  text: Type.String({ minLength: 1 }),
  who: Type.Optional(Type.String()),
  toWhom: Type.Optional(Type.String()),
  dueDate: Type.Optional(Type.String()),
  actor: Type.Optional(Type.String()),
  action: Type.Optional(Type.String()),
  target: Type.Optional(Type.String()),
  deadline: Type.Optional(Type.String()),
  sourceMessageId: Type.Optional(Type.String()),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  sourceType: Type.Optional(Type.Union([
    Type.Literal("message"), Type.Literal("meeting"), Type.Literal("voice"), Type.Literal("manual"),
  ])),
  sourceId: Type.Optional(Type.String()),
  contactId: Type.Optional(Type.String()),
  meetingId: Type.Optional(Type.String()),
});
export type CommitmentAddParams = Static<typeof CommitmentAddSchema>;

export const CommitmentListSchema = Type.Object({
  status: Type.Optional(Type.Union([
    Type.Literal("open"), Type.Literal("due_soon"), Type.Literal("overdue"),
    Type.Literal("completed"), Type.Literal("cancelled"),
  ])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});
export type CommitmentListParams = Static<typeof CommitmentListSchema>;

export const CommitmentUpdateSchema = Type.Object({
  id: Type.String(),
  text: Type.Optional(Type.String()),
  status: Type.Optional(Type.Union([
    Type.Literal("open"), Type.Literal("due_soon"), Type.Literal("overdue"),
    Type.Literal("completed"), Type.Literal("cancelled"),
  ])),
  dueDate: Type.Optional(Type.String()),
});
export type CommitmentUpdateParams = Static<typeof CommitmentUpdateSchema>;

/** Phase 17 — Proactive assistant: calendar, briefing, anomalies */

export type EventKind = "meeting" | "event" | "focus" | "other";

export type CalendarEventStatus = "scheduled" | "cancelled";

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  participants: string[];
  location?: string;
  kind: EventKind;
  source: string;
  status: CalendarEventStatus;
  createdAt: string;
  updatedAt: string;
}

export type BriefingKind =
  | "event"
  | "meeting"
  | "commitment"
  | "followup"
  | "client_note"
  | "anomaly"
  | "approval";

export interface BriefingItem {
  kind: BriefingKind;
  title: string;
  detail?: string;
  dueAt?: string;
  severity?: "info" | "warning" | "critical";
}

export type AnomalyStatus = "new" | "acknowledged" | "resolved";

export interface Anomaly {
  id: string;
  userId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  detectedAt: string;
  explanation: string;
  evidence: Record<string, unknown>;
  status: AnomalyStatus;
}

export const EventAddSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  startsAt: Type.String(),
  endsAt: Type.String(),
  timezone: Type.Optional(Type.String()),
  participants: Type.Optional(Type.Array(Type.String())),
  location: Type.Optional(Type.String()),
  kind: Type.Optional(Type.Union([
    Type.Literal("meeting"), Type.Literal("event"), Type.Literal("focus"), Type.Literal("other"),
  ])),
});
export type EventAddParams = Static<typeof EventAddSchema>;

export const EventListSchema = Type.Object({
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  kind: Type.Optional(Type.Union([
    Type.Literal("meeting"), Type.Literal("event"), Type.Literal("focus"), Type.Literal("other"),
  ])),
});
export type EventListParams = Static<typeof EventListSchema>;

export const EventCancelSchema = Type.Object({ id: Type.String() });
export type EventCancelParams = Static<typeof EventCancelSchema>;

export const BriefingGenerateSchema = Type.Object({
  timezone: Type.Optional(Type.String()),
  force: Type.Optional(Type.Boolean()),
});
export type BriefingGenerateParams = Static<typeof BriefingGenerateSchema>;

export const AnomalyAckSchema = Type.Object({
  id: Type.String(),
  status: Type.Union([Type.Literal("acknowledged"), Type.Literal("resolved")]),
});
export type AnomalyAckParams = Static<typeof AnomalyAckSchema>;

export const ContactBriefingSchema = Type.Object({ contactName: Type.String({ minLength: 1 }) });
export type ContactBriefingParams = Static<typeof ContactBriefingSchema>;

export const MeetingPrepSchema = Type.Object({ eventId: Type.String() });
export type MeetingPrepParams = Static<typeof MeetingPrepSchema>;

/** Phase 18 — Finance + CRM */

export interface Expense {
  id: string;
  userId: string;
  date: string;
  vendor: string;
  amount: number;
  currency: string;
  category?: string;
  paymentMethod?: string;
  documentId?: string;
  confidence: number;
  source: "ocr" | "voice" | "manual";
  createdAt: string;
}

export type InvoiceStatus = "draft" | "sent" | "due" | "overdue" | "paid" | "cancelled";

export interface Invoice {
  id: string;
  userId: string;
  number: string;
  vendor?: string;
  amount: number;
  currency: string;
  dueDate?: string;
  status: InvoiceStatus;
  contactId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  userId: string;
  name: string;
  tags: string[];
  lastInteractionAt?: string;
  provenance?: string;
  createdAt: string;
  updatedAt: string;
}

export const ExpenseAddSchema = Type.Object({
  date: Type.String(),
  vendor: Type.String({ minLength: 1 }),
  amount: Type.Number(),
  currency: Type.String({ minLength: 1 }),
  category: Type.Optional(Type.String()),
  paymentMethod: Type.Optional(Type.String()),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  source: Type.Optional(Type.Union([Type.Literal("ocr"), Type.Literal("voice"), Type.Literal("manual")])),
});
export type ExpenseAddParams = Static<typeof ExpenseAddSchema>;

export const ExpenseListSchema = Type.Object({
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
});
export type ExpenseListParams = Static<typeof ExpenseListSchema>;

export const InvoiceAddSchema = Type.Object({
  number: Type.String({ minLength: 1 }),
  vendor: Type.Optional(Type.String()),
  amount: Type.Number(),
  currency: Type.String({ minLength: 1 }),
  dueDate: Type.Optional(Type.String()),
  contactId: Type.Optional(Type.String()),
});
export type InvoiceAddParams = Static<typeof InvoiceAddSchema>;

export const InvoiceSetStatusSchema = Type.Object({
  id: Type.String(),
  status: Type.Union([
    Type.Literal("draft"), Type.Literal("sent"), Type.Literal("due"),
    Type.Literal("overdue"), Type.Literal("paid"), Type.Literal("cancelled"),
  ]),
});
export type InvoiceSetStatusParams = Static<typeof InvoiceSetStatusSchema>;

export const FinanceSummarySchema = Type.Object({
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
});
export type FinanceSummaryParams = Static<typeof FinanceSummarySchema>;

export const TransactionCategorizeSchema = Type.Object({
  vendor: Type.String({ minLength: 1 }),
  amount: Type.Optional(Type.Number()),
});
export type TransactionCategorizeParams = Static<typeof TransactionCategorizeSchema>;

export const ContactUpsertSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  tags: Type.Optional(Type.Array(Type.String())),
});
export type ContactUpsertParams = Static<typeof ContactUpsertSchema>;

/** Phase 19 — Connector-ready architecture */

export type ExternalCapability =
  | "email.read"
  | "email.draft"
  | "email.send"
  | "calendar.read"
  | "calendar.write"
  | "travel.read"
  | "travel.book"
  | "crm.read"
  | "crm.write"
  | "accounting.read"
  | "accounting.write";

export type TravelItemKind = "flight" | "hotel" | "transfer" | "other";

export interface TravelItem {
  id: string;
  userId: string;
  tripId: string;
  kind: TravelItemKind;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  confirmationRef?: string;
  source: string;
  createdAt: string;
}

export const TravelItemAddSchema = Type.Object({
  tripId: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal("flight"), Type.Literal("hotel"), Type.Literal("transfer"), Type.Literal("other"),
  ]),
  title: Type.String({ minLength: 1 }),
  startsAt: Type.String(),
  endsAt: Type.String(),
  location: Type.Optional(Type.String()),
  confirmationRef: Type.Optional(Type.String()),
});
export type TravelItemAddParams = Static<typeof TravelItemAddSchema>;

export const TravelListSchema = Type.Object({
  tripId: Type.Optional(Type.String()),
  days: Type.Optional(Type.Number({ minimum: 0 })),
});
export type TravelListParams = Static<typeof TravelListSchema>;
