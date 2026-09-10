import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RuleClass, RuleKind, RuleScope, UserRule } from "@griha/shared-types";
import { getConfigDir } from "@griha/config";
import { detectKind } from "./prefilter.js";

const GLOBAL_KEY = "__global__";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_rules (
  id            TEXT PRIMARY KEY,
  scope         TEXT NOT NULL,
  chat_id       TEXT,
  owner_user_id TEXT,
  text          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'soft',
  rule_class    TEXT,
  rule_key      TEXT,
  rule_value    TEXT,
  source        TEXT,
  created_by    TEXT,
  priority      INTEGER NOT NULL DEFAULT 100,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_rules_scope_chat ON user_rules(scope, chat_id);
CREATE INDEX IF NOT EXISTS idx_user_rules_enabled ON user_rules(enabled);
`;

interface RuleRow {
  id: string;
  scope: string;
  chat_id: string | null;
  owner_user_id: string | null;
  text: string;
  kind: string;
  rule_class: string | null;
  rule_key: string | null;
  rule_value: string | null;
  source: string | null;
  created_by: string | null;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface RuleAddInput {
  scope: RuleScope;
  chatId?: string;
  text: string;
  kind?: RuleKind;
  ruleClass?: RuleClass;
  ownerUserId?: string;
}

export interface RuleEditPatch {
  text?: string;
  enabled?: boolean;
  kind?: RuleKind;
  ruleClass?: RuleClass;
}

/** Structured rule для managed-пресетов (chat onboarding). */
export interface ManagedRuleInput {
  key: string;
  value: string | boolean | number;
  kind: RuleKind;
}

/** Managed-ключи, которыми управляет ChatSetup (presets). */
export const MANAGED_RULE_KEYS: readonly string[] = [
  "require_mention",
  "reply_to_bot",
  "ignore_bots",
  "ignore_service",
  "ignore_if_other_mention",
  "listen_only",
  "only_my_messages",
  "only_my_messages_user_id",
  "language_mirror",
  "style",
  "length",
  "memory_write",
  "no_hallucinate_data",
  "archive_media",
  "archive_ocr_ingest",
  "notify_poor_ocr",
  "poor_ocr_confidence_below",
];

export interface RuleListFilter {
  scope?: RuleScope;
  chatId?: string;
  enabledOnly?: boolean;
}

/**
 * Deterministic SQLite-backed store for user rules + in-memory cache keyed by
 * scope/chat. The cache is rebuilt on every mutation, so hard-rule checks are
 * O(1) lookups and never touch the LLM.
 */
export class UserRulesService {
  private db: Database.Database | null = null;
  private cache = new Map<string, UserRule[]>();

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("UserRulesService not initialized — call init() first");
    return this.db;
  }

  /** Synchronous init: open DB, create schema, load cache. */
  init(): void {
    if (this.db) this.db.close();
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
    this.rebuildCache();
  }

  /** Add rule_class column onto older rule DBs. */
  private migrate(): void {
    const db = this.requireDb();
    const columns = new Set(
      (db.pragma("table_info(user_rules)") as Array<{ name: string }>).map((c) => c.name),
    );
    if (!columns.has("rule_class")) {
      db.exec(`ALTER TABLE user_rules ADD COLUMN rule_class TEXT`);
    }
    if (!columns.has("rule_key")) {
      db.exec(`ALTER TABLE user_rules ADD COLUMN rule_key TEXT`);
    }
    if (!columns.has("rule_value")) {
      db.exec(`ALTER TABLE user_rules ADD COLUMN rule_value TEXT`);
    }
    if (!columns.has("source")) {
      db.exec(`ALTER TABLE user_rules ADD COLUMN source TEXT`);
    }
    if (!columns.has("created_by")) {
      db.exec(`ALTER TABLE user_rules ADD COLUMN created_by TEXT`);
    }
    if (!columns.has("priority")) {
      db.exec(`ALTER TABLE user_rules ADD COLUMN priority INTEGER NOT NULL DEFAULT 100`);
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private rebuildCache(): void {
    const rows = this.requireDb()
      .prepare(`SELECT * FROM user_rules ORDER BY created_at ASC`)
      .all() as RuleRow[];

    const map = new Map<string, UserRule[]>();
    for (const row of rows) {
      const rule = this.rowToRule(row);
      const key = rule.scope === "global" ? GLOBAL_KEY : (rule.chatId ?? GLOBAL_KEY);
      const list = map.get(key) ?? [];
      list.push(rule);
      map.set(key, list);
    }
    this.cache = map;
  }

  private rulesFor(chatId?: string): UserRule[] {
    const global = this.cache.get(GLOBAL_KEY) ?? [];
    const chat = chatId ? (this.cache.get(chatId) ?? []) : [];
    return [...global, ...chat];
  }

  /** Hard rules (enabled) for global + chat — used by Layer 1 pre-filter. */
  getHardRules(chatId?: string): UserRule[] {
    return this.rulesFor(chatId).filter((r) => r.kind === "hard" && r.enabled);
  }

  /** Soft rules (enabled) for global + chat — used by Layer 2 injection. */
  getSoftRules(chatId?: string): UserRule[] {
    return this.rulesFor(chatId).filter((r) => r.kind === "soft" && r.enabled);
  }

  list(filter: RuleListFilter = {}): UserRule[] {
    let rules = this.rulesFor(filter.chatId);
    if (filter.scope === "global") rules = rules.filter((r) => r.scope === "global");
    if (filter.scope === "chat") rules = rules.filter((r) => r.scope === "chat");
    if (filter.enabledOnly !== false) rules = rules.filter((r) => r.enabled);
    return rules;
  }

  get(id: string): UserRule | null {
    const row = this.requireDb().prepare(`SELECT * FROM user_rules WHERE id = ?`).get(id) as
      | RuleRow
      | undefined;
    return row ? this.rowToRule(row) : null;
  }

  add(input: RuleAddInput): UserRule {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    if (input.scope === "chat" && !input.chatId) {
      throw new Error("chatId is required for scope=chat");
    }
    const row: RuleRow = {
      id,
      scope: input.scope,
      chat_id: input.scope === "chat" ? (input.chatId ?? null) : null,
      owner_user_id: input.ownerUserId ?? null,
      text: input.text,
      kind: input.kind ?? detectKind(input.text),
      rule_class: input.ruleClass ?? defaultRuleClass(input.kind ?? detectKind(input.text)),
      rule_key: null,
      rule_value: null,
      source: null,
      created_by: null,
      priority: 100,
      enabled: 1,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO user_rules (id, scope, chat_id, owner_user_id, text, kind, rule_class, rule_key, rule_value, source, created_by, priority, enabled, created_at, updated_at)
       VALUES (@id, @scope, @chat_id, @owner_user_id, @text, @kind, @rule_class, @rule_key, @rule_value, @source, @created_by, @priority, @enabled, @created_at, @updated_at)`,
    ).run(row);
    this.rebuildCache();
    return this.rowToRule(row);
  }

  edit(id: string, patch: RuleEditPatch): UserRule | null {
    const db = this.requireDb();
    const existing = this.get(id);
    if (!existing) return null;

    const next: UserRule = {
      ...existing,
      text: patch.text ?? existing.text,
      kind: patch.kind ?? existing.kind,
      ruleClass: patch.ruleClass ?? existing.ruleClass ?? defaultRuleClass(patch.kind ?? existing.kind),
      enabled: patch.enabled ?? existing.enabled,
      updatedAt: new Date().toISOString(),
    };

    db.prepare(
      `UPDATE user_rules SET text = ?, kind = ?, rule_class = ?, enabled = ?, updated_at = ? WHERE id = ?`,
    ).run(next.text, next.kind, next.ruleClass, next.enabled ? 1 : 0, next.updatedAt, id);
    this.rebuildCache();
    return next;
  }

  setEnabled(id: string, enabled: boolean): UserRule | null {
    return this.edit(id, { enabled });
  }

  delete(id: string): boolean {
    const db = this.requireDb();
    const info = db.prepare(`DELETE FROM user_rules WHERE id = ?`).run(id);
    this.rebuildCache();
    return info.changes > 0;
  }

  private rowToRule(row: RuleRow): UserRule {
    let value: string | boolean | number | null = null;
    if (row.rule_value !== null) {
      try {
        value = JSON.parse(row.rule_value) as string | boolean | number;
      } catch {
        value = row.rule_value;
      }
    }
    return {
      id: row.id,
      scope: row.scope as RuleScope,
      chatId: row.chat_id ?? null,
      ownerUserId: row.owner_user_id ?? null,
      text: row.text,
      kind: row.kind as RuleKind,
      ruleClass: (row.rule_class ?? defaultRuleClass(row.kind as RuleKind)) as RuleClass,
      enabled: row.enabled !== 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      key: row.rule_key,
      value,
      source: row.source,
      createdBy: row.created_by,
      priority: row.priority,
    };
  }

  /**
   * Заменяет managed-правила чата (structured keys из пресета).
   * Чужие custom-правила с ключами вне managed set НЕ трогаются.
   */
  replaceChatManagedRules(
    chatId: string,
    rules: ManagedRuleInput[],
    meta: { source: string; actorId: string },
  ): void {
    const db = this.requireDb();
    const now = new Date().toISOString();

    const placeholders = MANAGED_RULE_KEYS.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM user_rules WHERE scope = 'chat' AND chat_id = ?
       AND (rule_key IN (${placeholders}) OR source LIKE 'preset:%' OR source = 'custom')`,
    ).run(chatId, ...MANAGED_RULE_KEYS);

    const insert = db.prepare(
      `INSERT INTO user_rules (id, scope, chat_id, text, kind, rule_class, rule_key, rule_value, source, created_by, priority, enabled, created_at, updated_at)
       VALUES (?, 'chat', ?, ?, ?, ?, ?, ?, ?, ?, 100, 1, ?, ?)`,
    );

    for (const rule of rules) {
      const id = randomUUID();
      insert.run(
        id,
        chatId,
        `${rule.key} = ${String(rule.value)}`,
        rule.kind,
        defaultRuleClass(rule.kind),
        rule.key,
        JSON.stringify(rule.value),
        meta.source,
        meta.actorId,
        now,
        now,
      );
    }
    this.rebuildCache();
  }
}

/** Intent class default: hard → restriction, soft → preference. */
function defaultRuleClass(kind: RuleKind): RuleClass {
  return kind === "hard" ? "restriction" : "preference";
}

let singleton: UserRulesService | null = null;

/** Process-lifetime singleton (one instance = one client). Lazy, sync init. */
export function getUserRulesService(): UserRulesService {
  if (!singleton) {
    singleton = new UserRulesService(path.join(getConfigDir(), "rules.sqlite"));
    singleton.init();
  }
  return singleton;
}
