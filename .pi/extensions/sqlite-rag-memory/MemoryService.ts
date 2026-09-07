import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  MemoryFact,
  SearchResult,
  SessionMessage,
  SessionId,
  ProjectId,
  BotId,
  SharedInsight,
} from "../../../src/types/index.js";
import type { MemoryService } from "./types.js";
import type { EmbeddingService } from "../../../src/utils/embeddings.js";

interface FactRow {
  id: string;
  content: string;
  category: string;
  project_id: string | null;
  agent_id: string | null;
  bot_id: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  embedding: Buffer | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  created_at: string;
  agent_id: string | null;
  bot_id: string | null;
  project_id: string | null;
}

interface FactSearchRow {
  id: string;
  content: string;
  category: string;
  project_id: string | null;
  bot_id: string | null;
  score: number;
}

interface InsightRow {
  id: string;
  content: string;
  source_bot_id: string | null;
  source_task_id: string | null;
  project_id: string | null;
  created_at: string;
  tags: string | null;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  project_id TEXT,
  agent_id TEXT,
  bot_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT,
  embedding BLOB
);

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(content, content='facts', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project_id);
CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
CREATE INDEX IF NOT EXISTS idx_facts_updated ON facts(updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  created_at TEXT NOT NULL,
  agent_id TEXT,
  bot_id TEXT,
  project_id TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source_bot_id TEXT,
  source_task_id TEXT,
  project_id TEXT,
  created_at TEXT NOT NULL,
  tags TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS insights_fts USING fts5(content, content='insights', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS insights_ai AFTER INSERT ON insights BEGIN
  INSERT INTO insights_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS insights_ad AFTER DELETE ON insights BEGIN
  INSERT INTO insights_fts(insights_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS insights_au AFTER UPDATE ON insights BEGIN
  INSERT INTO insights_fts(insights_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO insights_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_insights_project ON insights(project_id);
`;

function buildFtsQuery(query: string): string | null {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}

function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function clampLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 10;
  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function reciprocalRankFusion(
  vector: SearchResult[],
  fts: SearchResult[],
  limit: number,
  k = 60,
): SearchResult[] {
  const fused = new Map<string, { result: SearchResult; score: number; sources: Set<string> }>();
  const add = (list: SearchResult[], source: "vector" | "fts") => {
    list.forEach((r, i) => {
      const entry = fused.get(r.id) ?? { result: r, score: 0, sources: new Set<string>() };
      entry.score += 1 / (k + i + 1);
      entry.sources.add(source);
      fused.set(r.id, entry);
    });
  };
  add(vector, "vector");
  add(fts, "fts");
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => ({
      ...e.result,
      score: e.score,
      source: e.sources.size > 1 ? "hybrid" : ([...e.sources][0] as SearchResult["source"]),
    }));
}

export class SqliteRagMemoryService implements MemoryService {
  private db: Database.Database | null = null;

  constructor(private readonly embeddingService?: EmbeddingService) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("MemoryService not initialized — call init(dbPath) first");
    return this.db;
  }

  async init(dbPath: string): Promise<void> {
    if (this.db) this.db.close();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  /** Add the `embedding` column to databases created before Phase 4. */
  private migrate(): void {
    const db = this.requireDb();
    const columns = db.prepare(`PRAGMA table_info(facts)`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "embedding")) {
      db.exec(`ALTER TABLE facts ADD COLUMN embedding BLOB`);
    }
  }

  async addFact(fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">): Promise<MemoryFact> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();

    let embedding: Buffer | null = null;
    if (this.embeddingService) {
      const vector = await this.embeddingService.embed(fact.content);
      embedding = Buffer.from(new Float32Array(vector).buffer);
    }

    const row: FactRow = {
      id,
      content: fact.content,
      category: fact.category,
      project_id: fact.projectId ?? null,
      agent_id: fact.agentId ?? null,
      bot_id: fact.botId ?? null,
      created_at: now,
      updated_at: now,
      metadata: fact.metadata != null ? JSON.stringify(fact.metadata) : null,
      embedding,
    };
    db.prepare(
      `INSERT INTO facts (id, content, category, project_id, agent_id, bot_id, created_at, updated_at, metadata, embedding)
       VALUES (@id, @content, @category, @project_id, @agent_id, @bot_id, @created_at, @updated_at, @metadata, @embedding)`,
    ).run(row);
    return this.rowToFact(row);
  }

  async search(
    query: string,
    options: { limit?: number; projectId?: ProjectId; category?: string; botId?: BotId } = {},
  ): Promise<SearchResult[]> {
    const limit = clampLimit(options.limit);
    const ftsHits = this.ftsSearch(query, options, limit * 2);

    if (!this.embeddingService) {
      return ftsHits.slice(0, limit);
    }

    const queryEmbedding = await this.embeddingService.embed(query);
    const vectorHits = this.vectorSearch(queryEmbedding, options, limit * 2);
    return reciprocalRankFusion(vectorHits, ftsHits, limit);
  }

  private ftsSearch(
    query: string,
    options: { projectId?: ProjectId; category?: string; botId?: BotId },
    limit: number,
  ): SearchResult[] {
    const db = this.requireDb();

    const filters: string[] = [];
    const params: unknown[] = [];
    if (options.projectId) {
      filters.push("f.project_id = ?");
      params.push(options.projectId);
    }
    if (options.category) {
      filters.push("f.category = ?");
      params.push(options.category);
    }
    if (options.botId) {
      filters.push("f.bot_id = ?");
      params.push(options.botId);
    }

    let rows: FactSearchRow[] = [];

    const fts = buildFtsQuery(query);
    if (fts) {
      try {
        const where = ["facts_fts MATCH ?", ...filters].join(" AND ");
        const sql = `SELECT f.id, f.content, f.category, f.project_id, f.bot_id, -bm25(facts_fts) AS score
          FROM facts_fts
          JOIN facts f ON f.rowid = facts_fts.rowid
          WHERE ${where}
          ORDER BY score DESC
          LIMIT ?`;
        rows = db.prepare(sql).all(fts, ...params, limit) as FactSearchRow[];
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      const like = `%${escapeLike(query)}%`;
      const where = [`f.content LIKE ? ESCAPE '\\'`, ...filters].join(" AND ");
      const sql = `SELECT f.id, f.content, f.category, f.project_id, f.bot_id, 1.0 AS score
        FROM facts f
        WHERE ${where}
        ORDER BY f.updated_at DESC
        LIMIT ?`;
      rows = db.prepare(sql).all(like, ...params, limit) as FactSearchRow[];
    }

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      score: r.score,
      source: "fts",
      metadata: {
        category: r.category,
        projectId: r.project_id ?? undefined,
        botId: r.bot_id ?? undefined,
      },
    }));
  }

  private vectorSearch(
    embedding: number[],
    options: { projectId?: ProjectId; category?: string; botId?: BotId },
    limit: number,
  ): SearchResult[] {
    const db = this.requireDb();
    const queryVec = new Float32Array(embedding);

    const filters: string[] = ["embedding IS NOT NULL"];
    const params: unknown[] = [];
    if (options.projectId) {
      filters.push("project_id = ?");
      params.push(options.projectId);
    }
    if (options.category) {
      filters.push("category = ?");
      params.push(options.category);
    }
    if (options.botId) {
      filters.push("bot_id = ?");
      params.push(options.botId);
    }

    const rows = db
      .prepare(
        `SELECT id, content, category, project_id, bot_id, embedding FROM facts WHERE ${filters.join(" AND ")}`,
      )
      .all(...params) as Array<{
      id: string;
      content: string;
      category: string;
      project_id: string | null;
      bot_id: string | null;
      embedding: Buffer;
    }>;

    return rows
      .map((r) => {
        const vec = new Float32Array(
          r.embedding.buffer,
          r.embedding.byteOffset,
          r.embedding.byteLength / 4,
        );
        return {
          id: r.id,
          content: r.content,
          score: cosineSimilarity(queryVec, vec),
          source: "vector" as const,
          metadata: {
            category: r.category,
            projectId: r.project_id ?? undefined,
            botId: r.bot_id ?? undefined,
          },
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async addMessage(msg: Omit<SessionMessage, "id" | "createdAt">): Promise<SessionMessage> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    const row: MessageRow = {
      id,
      session_id: msg.sessionId,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.toolCalls != null ? JSON.stringify(msg.toolCalls) : null,
      created_at: now,
      agent_id: msg.agentId ?? null,
      bot_id: msg.botId ?? null,
      project_id: msg.projectId ?? null,
    };
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, tool_calls, created_at, agent_id, bot_id, project_id)
       VALUES (@id, @session_id, @role, @content, @tool_calls, @created_at, @agent_id, @bot_id, @project_id)`,
    ).run(row);
    return this.rowToMessage(row);
  }

  async getSessionMessages(sessionId: SessionId, limit?: number): Promise<SessionMessage[]> {
    const db = this.requireDb();
    let rows: MessageRow[];
    if (typeof limit === "number" && limit > 0) {
      rows = db
        .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`)
        .all(sessionId, Math.trunc(limit)) as MessageRow[];
    } else {
      rows = db
        .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`)
        .all(sessionId) as MessageRow[];
    }
    return rows.map((r) => this.rowToMessage(r));
  }

  async searchSessions(
    query: string,
    options: { limit?: number; projectId?: ProjectId; botId?: BotId } = {},
  ): Promise<SearchResult[]> {
    const db = this.requireDb();
    const limit = clampLimit(options.limit);

    const filters: string[] = [];
    const params: unknown[] = [];
    if (options.projectId) {
      filters.push("m.project_id = ?");
      params.push(options.projectId);
    }
    if (options.botId) {
      filters.push("m.bot_id = ?");
      params.push(options.botId);
    }

    let rows: Array<{
      id: string;
      content: string;
      session_id: string;
      role: string;
      project_id: string | null;
      bot_id: string | null;
      score: number;
    }> = [];

    const fts = buildFtsQuery(query);
    if (fts) {
      try {
        const where = ["messages_fts MATCH ?", ...filters].join(" AND ");
        const sql = `SELECT m.id, m.content, m.session_id, m.role, m.project_id, m.bot_id, -bm25(messages_fts) AS score
          FROM messages_fts
          JOIN messages m ON m.rowid = messages_fts.rowid
          WHERE ${where}
          ORDER BY score DESC
          LIMIT ?`;
        rows = db.prepare(sql).all(fts, ...params, limit) as typeof rows;
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      const like = `%${escapeLike(query)}%`;
      const where = [`m.content LIKE ? ESCAPE '\\'`, ...filters].join(" AND ");
      const sql = `SELECT m.id, m.content, m.session_id, m.role, m.project_id, m.bot_id, 1.0 AS score
        FROM messages m
        WHERE ${where}
        ORDER BY m.created_at DESC
        LIMIT ?`;
      rows = db.prepare(sql).all(like, ...params, limit) as typeof rows;
    }

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      score: r.score,
      source: "fts",
      metadata: {
        sessionId: r.session_id,
        role: r.role,
        projectId: r.project_id ?? undefined,
        botId: r.bot_id ?? undefined,
      },
    }));
  }

  async listRecentFacts(limit?: number, projectId?: ProjectId): Promise<MemoryFact[]> {
    const db = this.requireDb();
    const n = clampLimit(limit ?? 10);
    let rows: FactRow[];
    if (projectId) {
      rows = db
        .prepare(`SELECT * FROM facts WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`)
        .all(projectId, n) as FactRow[];
    } else {
      rows = db.prepare(`SELECT * FROM facts ORDER BY updated_at DESC LIMIT ?`).all(n) as FactRow[];
    }
    return rows.map((r) => this.rowToFact(r));
  }

  async getEmbedding(id: string): Promise<Float32Array | null> {
    const db = this.requireDb();
    const row = db.prepare(`SELECT embedding FROM facts WHERE id = ?`).get(id) as
      | { embedding: Buffer | null }
      | undefined;
    if (!row?.embedding) return null;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  }

  async reembedMissing(): Promise<number> {
    if (!this.embeddingService) return 0;
    const db = this.requireDb();
    const rows = db
      .prepare(`SELECT id, content FROM facts WHERE embedding IS NULL`)
      .all() as Array<{ id: string; content: string }>;
    const update = db.prepare(`UPDATE facts SET embedding = ? WHERE id = ?`);
    let count = 0;
    for (const r of rows) {
      const vector = await this.embeddingService.embed(r.content);
      update.run(Buffer.from(new Float32Array(vector).buffer), r.id);
      count++;
    }
    return count;
  }

  async addInsight(insight: Omit<SharedInsight, "id" | "createdAt">): Promise<SharedInsight> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    const row: InsightRow = {
      id,
      content: insight.content,
      source_bot_id: insight.sourceBotId ?? null,
      source_task_id: insight.sourceTaskId ?? null,
      project_id: insight.projectId ?? null,
      created_at: now,
      tags: insight.tags != null ? JSON.stringify(insight.tags) : null,
    };
    db.prepare(
      `INSERT INTO insights (id, content, source_bot_id, source_task_id, project_id, created_at, tags)
       VALUES (@id, @content, @source_bot_id, @source_task_id, @project_id, @created_at, @tags)`,
    ).run(row);
    return this.rowToInsight(row);
  }

  async searchInsights(
    query: string,
    options: { limit?: number; projectId?: string } = {},
  ): Promise<SearchResult[]> {
    const db = this.requireDb();
    const limit = clampLimit(options.limit);

    const filters: string[] = [];
    const params: unknown[] = [];
    if (options.projectId) {
      filters.push("i.project_id = ?");
      params.push(options.projectId);
    }

    let rows: Array<{ id: string; content: string; project_id: string | null; score: number }> = [];

    const fts = buildFtsQuery(query);
    if (fts) {
      try {
        const where = ["insights_fts MATCH ?", ...filters].join(" AND ");
        const sql = `SELECT i.id, i.content, i.project_id, -bm25(insights_fts) AS score
          FROM insights_fts
          JOIN insights i ON i.rowid = insights_fts.rowid
          WHERE ${where}
          ORDER BY score DESC
          LIMIT ?`;
        rows = db.prepare(sql).all(fts, ...params, limit) as typeof rows;
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      const like = `%${escapeLike(query)}%`;
      const where = [`i.content LIKE ? ESCAPE '\\'`, ...filters].join(" AND ");
      const sql = `SELECT i.id, i.content, i.project_id, 1.0 AS score
        FROM insights i
        WHERE ${where}
        ORDER BY i.created_at DESC
        LIMIT ?`;
      rows = db.prepare(sql).all(like, ...params, limit) as typeof rows;
    }

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      score: r.score,
      source: "fts",
      metadata: { projectId: r.project_id ?? undefined },
    }));
  }

  async listRecentInsights(limit?: number, projectId?: string): Promise<SharedInsight[]> {
    const db = this.requireDb();
    const n = clampLimit(limit ?? 10);
    let rows: InsightRow[];
    if (projectId) {
      rows = db
        .prepare(`SELECT * FROM insights WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(projectId, n) as InsightRow[];
    } else {
      rows = db.prepare(`SELECT * FROM insights ORDER BY created_at DESC LIMIT ?`).all(n) as InsightRow[];
    }
    return rows.map((r) => this.rowToInsight(r));
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private rowToFact(row: FactRow): MemoryFact {
    return {
      id: row.id,
      content: row.content,
      category: row.category as MemoryFact["category"],
      projectId: row.project_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      botId: row.bot_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata != null ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      embedding: row.embedding ?? undefined,
    };
  }

  private rowToInsight(row: InsightRow): SharedInsight {
    return {
      id: row.id,
      content: row.content,
      sourceBotId: row.source_bot_id ?? undefined,
      sourceTaskId: row.source_task_id ?? undefined,
      projectId: row.project_id ?? undefined,
      createdAt: row.created_at,
      tags: row.tags != null ? (JSON.parse(row.tags) as string[]) : undefined,
    };
  }

  private rowToMessage(row: MessageRow): SessionMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as SessionMessage["role"],
      content: row.content,
      toolCalls: row.tool_calls != null ? (JSON.parse(row.tool_calls) as unknown[]) : undefined,
      createdAt: row.created_at,
      agentId: row.agent_id ?? undefined,
      botId: row.bot_id ?? undefined,
      projectId: row.project_id ?? undefined,
    };
  }
}
