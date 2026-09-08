import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Anomaly, AnomalyStatus } from "../../../src/types/index.js";
import { toAnomaly, type AnomalyInput } from "../../../src/utils/anomaly-detect.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS anomalies (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence    TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS idx_anomalies_user_status ON anomalies(user_id, status);
`;

interface AnomalyRow {
  id: string;
  user_id: string;
  type: string;
  severity: string;
  detected_at: string;
  explanation: string;
  evidence: string;
  status: string;
}

function rowToAnomaly(row: AnomalyRow): Anomaly {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    severity: row.severity as Anomaly["severity"],
    detectedAt: row.detected_at,
    explanation: row.explanation,
    evidence: JSON.parse(row.evidence) as Record<string, unknown>,
    status: row.status as AnomalyStatus,
  };
}

/** Deterministic SQLite store for anomalies. */
export class AnomalyService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("AnomalyService not initialized — call init() first");
    return this.db;
  }

  init(): void {
    if (this.db) this.db.close();
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Record anomalies, skipping exact duplicates already stored as "new". */
  record(inputs: AnomalyInput[], now: Date = new Date()): Anomaly[] {
    const db = this.requireDb();
    const out: Anomaly[] = [];
    for (const input of inputs) {
      const duplicate = db
        .prepare(
          `SELECT id FROM anomalies WHERE user_id = ? AND type = ? AND explanation = ? AND status = 'new'`,
        )
        .get(input.userId, input.type, input.explanation) as { id: string } | undefined;
      if (duplicate) continue;

      const id = randomUUID();
      const anomaly = toAnomaly(id, input, now.toISOString());
      db.prepare(
        `INSERT INTO anomalies (id, user_id, type, severity, detected_at, explanation, evidence, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        anomaly.id,
        anomaly.userId,
        anomaly.type,
        anomaly.severity,
        anomaly.detectedAt,
        anomaly.explanation,
        JSON.stringify(anomaly.evidence),
        anomaly.status,
      );
      out.push(anomaly);
    }
    return out;
  }

  list(userId: string, options?: { status?: AnomalyStatus; limit?: number }): Anomaly[] {
    const db = this.requireDb();
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
    const rows = options?.status
      ? (db
          .prepare(`SELECT * FROM anomalies WHERE user_id = ? AND status = ? ORDER BY detected_at DESC LIMIT ?`)
          .all(userId, options.status, limit) as AnomalyRow[])
      : (db
          .prepare(`SELECT * FROM anomalies WHERE user_id = ? ORDER BY detected_at DESC LIMIT ?`)
          .all(userId, limit) as AnomalyRow[]);
    return rows.map(rowToAnomaly);
  }

  setStatus(id: string, status: "acknowledged" | "resolved"): boolean {
    const result = this.requireDb()
      .prepare(`UPDATE anomalies SET status = ? WHERE id = ?`)
      .run(status, id);
    return result.changes > 0;
  }
}
