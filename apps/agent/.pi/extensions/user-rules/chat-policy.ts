/**
 * Chat Policy engine (PROMPT 06):
 * - versioned ChatPolicy (response.mode / archive.* / processing.* / agent)
 * - SQLite: chat_policy (текущая версия) + chat_policy_history (audit trail)
 * - deterministic runtime: evaluateChatPolicy — никакого LLM на сообщение
 *
 * Policy — это ДАННЫЕ, а не код: custom rules не могут менять security/ACL/
 * tools/filesystem/SQL. Структура policy жёстко типизирована.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { getConfigDir } from "@griha/config";
import type { UserRule } from "@griha/shared-types";
import { isOnlyOwnerRule } from "./prefilter.js";

export type ResponseMode =
  | "never"
  | "mention"
  | "reply"
  | "mention_or_reply"
  | "always";

export interface ChatPolicy {
  version: number;
  response: {
    mode: ResponseMode;
    allowedUserIds?: string[];
  };
  archive: {
    text: boolean;
    photo: boolean;
    document: boolean;
    voice: boolean;
  };
  processing: {
    photoOcr: boolean;
    documentOcr: boolean;
    voiceStt: boolean;
    /** G3: лимит vision-вызовов на чат в час. */
    maxOcrPerHour?: number;
    minFileSizeBytes?: number;
    maxFileSizeBytes?: number;
    skipIfNoDocumentHint?: boolean;
  };
  agent: {
    enabled: boolean;
  };
  inbound?: {
    ignoreBots?: boolean;
    ignoreService?: boolean;
    ignoreIfOtherMention?: boolean;
    /** legacy-правило «только мои сообщения» (ownerUserId). */
    onlyFromUserIds?: string[];
  };
}

export interface PolicyInput {
  chatId: string;
  fromUserId: string;
  text: string;
  isGroup?: boolean;
  isChannel?: boolean;
  fromIsBot?: boolean;
  isService?: boolean;
  botMentioned?: boolean;
  repliedToBot?: boolean;
  startsWithOtherMention?: boolean;
  groupConfigured?: boolean;
  contentKind?: "text" | "photo" | "document" | "voice" | "other";
}

export interface TurnDecision {
  archive: boolean;
  processMedia: boolean;
  invokeAgent: boolean;
  reply: boolean;
  reason: string;
}

function blocked(reason: string): TurnDecision {
  return {
    archive: false,
    processMedia: false,
    invokeAgent: false,
    reply: false,
    reason,
  };
}

// ── Structured rules → ChatPolicy ─────────────────────────────────────────────

function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0) {
    return Number(v);
  }
  return undefined;
}

function lastValue(rules: UserRule[], key: string): unknown {
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (r.key === key && r.value !== null && r.value !== undefined) return r.value;
  }
  return undefined;
}

/** Собрать детерминированную policy из structured-правил чата. */
export function rulesToChatPolicy(rules: UserRule[]): Omit<ChatPolicy, "version"> {
  const listenOnly = truthy(lastValue(rules, "listen_only"));
  const requireMention = truthy(lastValue(rules, "require_mention"));
  const replyToBot = lastValue(rules, "reply_to_bot") !== false;
  const archiveMedia = truthy(lastValue(rules, "archive_media"));
  const ocrIngest = truthy(lastValue(rules, "archive_ocr_ingest"));
  const ignoreBots = lastValue(rules, "ignore_bots") !== false;
  const ignoreService = lastValue(rules, "ignore_service") !== false;
  const ignoreIfOtherMention = truthy(lastValue(rules, "ignore_if_other_mention"));
  const onlyMy = truthy(lastValue(rules, "only_my_messages"));
  const onlyMyUserId = String(lastValue(rules, "only_my_messages_user_id") ?? "");

  const mode: ResponseMode = listenOnly
    ? "mention_or_reply" // слушатель отвечает только на @/reply
    : requireMention
      ? replyToBot
        ? "mention_or_reply"
        : "mention"
      : "always"; // reply_to_bot сам по себе не ограничивает (без require_mention)

  const legacyOwner = [...rules].reverse().find((r) => isOnlyOwnerRule(r) && r.ownerUserId);

  return {
    response: {
      mode,
      allowedUserIds: onlyMy && onlyMyUserId ? [onlyMyUserId] : undefined,
    },
    archive: {
      text: listenOnly,
      photo: listenOnly || archiveMedia,
      document: listenOnly || archiveMedia,
      voice: listenOnly || archiveMedia,
    },
    processing: {
      photoOcr: listenOnly || ocrIngest,
      documentOcr: listenOnly || ocrIngest,
      voiceStt: listenOnly || archiveMedia,
      maxOcrPerHour: toNumber(lastValue(rules, "ocr_max_per_hour")),
      minFileSizeBytes: toNumber(lastValue(rules, "ocr_min_bytes")),
      maxFileSizeBytes: toNumber(lastValue(rules, "ocr_max_bytes")),
      skipIfNoDocumentHint: truthy(lastValue(rules, "ocr_skip_no_hint")),
    },
    agent: { enabled: true },
    inbound: {
      ignoreBots,
      ignoreService,
      ignoreIfOtherMention,
      onlyFromUserIds:
        onlyMy && onlyMyUserId
          ? [onlyMyUserId]
          : legacyOwner?.ownerUserId
            ? [legacyOwner.ownerUserId]
            : undefined,
    },
  };
}

// ── Deterministic evaluation ─────────────────────────────────────────────────

export function evaluateChatPolicy(policy: ChatPolicy, input: PolicyInput): TurnDecision {
  const isManaged = input.isGroup === true || input.isChannel === true;
  if (isManaged && input.groupConfigured === false) {
    return blocked("chat-not-configured");
  }
  const inbound = policy.inbound ?? {};
  if (inbound.ignoreBots && input.fromIsBot) return blocked("bot-ignored");
  if (inbound.ignoreService && input.isService) return blocked("service-ignored");
  if (inbound.ignoreIfOtherMention && input.startsWithOtherMention) {
    return blocked("other-mention");
  }
  if (inbound.onlyFromUserIds?.length && !inbound.onlyFromUserIds.includes(input.fromUserId)) {
    return blocked("only-from");
  }

  const kind = input.contentKind ?? "text";
  const archiveKind =
    kind === "photo"
      ? policy.archive.photo
      : kind === "document"
        ? policy.archive.document
        : kind === "voice"
          ? policy.archive.voice
          : policy.archive.text;
  const processKind =
    kind === "photo"
      ? policy.processing.photoOcr
      : kind === "document"
        ? policy.processing.documentOcr
        : kind === "voice"
          ? policy.processing.voiceStt
          : false;

  const mode = policy.response.mode;
  const modeOk =
    mode === "always" ||
    (mode === "mention" && input.botMentioned === true) ||
    (mode === "reply" && input.repliedToBot === true) ||
    (mode === "mention_or_reply" &&
      (input.botMentioned === true || input.repliedToBot === true));

  // Канал/sender_chat: обычного пользователя нет — агента не вызываем.
  const hasUser = input.fromUserId !== "" && input.fromUserId !== undefined;
  const invokeAgent = policy.agent.enabled === true && modeOk && hasUser;

  return {
    archive: archiveKind === true,
    processMedia: archiveKind === true || processKind === true || invokeAgent,
    invokeAgent,
    reply: invokeAgent,
    reason: invokeAgent
      ? "agent"
      : archiveKind
        ? "archived-silent"
        : "policy-blocked",
  };
}

/** Оценка прямо из правил SQLite (production path — deterministic, без LLM). */
export function evaluatePolicyFromRules(
  rules: UserRule[],
  input: PolicyInput,
): TurnDecision {
  const policy: ChatPolicy = { version: 0, ...rulesToChatPolicy(rules) };
  return evaluateChatPolicy(policy, input);
}

// ── SQLite store: chat_policy + chat_policy_history ───────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_policy (
  chat_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_policy_history (
  id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policy_history_chat
  ON chat_policy_history(chat_id, version);
`;

export interface StoredChatPolicy {
  chatId: string;
  version: number;
  source: string;
  createdBy: string;
  policy: ChatPolicy;
  createdAt: string;
  updatedAt: string;
}

interface PolicyRow {
  chat_id: string;
  version: number;
  source: string;
  created_by: string;
  policy_json: string;
  created_at: string;
  updated_at: string;
}

function rowToStored(row: PolicyRow): StoredChatPolicy {
  return {
    chatId: row.chat_id,
    version: row.version,
    source: row.source,
    createdBy: row.created_by,
    policy: JSON.parse(row.policy_json) as ChatPolicy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ChatPolicyStore {
  private db: Database.Database;

  constructor(dbPath: string = path.join(getConfigDir(), "chat-policy.sqlite")) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  get(chatId: string): StoredChatPolicy | null {
    const row = this.db
      .prepare(`SELECT * FROM chat_policy WHERE chat_id = ?`)
      .get(chatId) as PolicyRow | undefined;
    return row ? rowToStored(row) : null;
  }

  /** Записать новую версию + строка в history (audit trail). */
  record(
    chatId: string,
    policy: Omit<ChatPolicy, "version">,
    meta: { source: string; actorId: string },
  ): StoredChatPolicy {
    const now = new Date().toISOString();
    const existing = this.get(chatId);
    const version = (existing?.version ?? 0) + 1;
    const full: ChatPolicy = { ...policy, version };
    const json = JSON.stringify(full);
    this.db
      .prepare(
        `INSERT INTO chat_policy
         (chat_id, version, source, created_by, policy_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           version = excluded.version, source = excluded.source,
           created_by = excluded.created_by, policy_json = excluded.policy_json,
           updated_at = excluded.updated_at`,
      )
      .run(chatId, version, meta.source, meta.actorId, json, now, now);
    this.db
      .prepare(
        `INSERT INTO chat_policy_history
         (chat_id, version, source, created_by, policy_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(chatId, version, meta.source, meta.actorId, json, now);
    return this.get(chatId)!;
  }

  history(chatId: string, limit = 50): StoredChatPolicy[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_policy_history WHERE chat_id = ? ORDER BY version DESC LIMIT ?`,
      )
      .all(chatId, limit) as PolicyRow[];
    return rows.map(rowToStored);
  }
}

let store: ChatPolicyStore | null = null;
export function getChatPolicyStore(): ChatPolicyStore {
  if (!store) store = new ChatPolicyStore();
  return store;
}

/** Записать версионированную policy из текущих правил чата (+history). */
export function recordChatPolicyFromRules(
  chatId: string,
  rules: UserRule[],
  meta: { source: string; actorId: string },
): StoredChatPolicy {
  return getChatPolicyStore().record(chatId, rulesToChatPolicy(rules), meta);
}

export function closeChatPolicyStore(): void {
  store?.close();
  store = null;
}
