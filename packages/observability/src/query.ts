import fs from "node:fs";
import path from "node:path";
import { defaultObsDir } from "./jsonl-sink.js";
import type { ObsEvent } from "./types.js";

export interface QueryFilter {
  event?: string;
  component?: string;
  chatId?: string;
  correlationId?: string;
  /** окно в минутах (default 60). */
  sinceMinutes?: number;
  /** default 50, max 200. */
  limit?: number;
}

function listEventFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"))
      .sort()
      .reverse(); // свежие файлы первыми
  } catch {
    return [];
  }
}

export function readObsEvents(opts: { dir?: string; filter?: QueryFilter }): ObsEvent[] {
  const dir = opts.dir ?? defaultObsDir();
  const filter = opts.filter ?? {};
  const sinceMinutes = filter.sinceMinutes ?? 60;
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const sinceTs = Date.now() - sinceMinutes * 60_000;

  const events: ObsEvent[] = [];
  for (const f of listEventFiles(dir)) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let e: ObsEvent;
      try {
        e = JSON.parse(t) as ObsEvent;
      } catch {
        continue; // битая строка
      }
      if (filter.event !== undefined && e.event !== filter.event) continue;
      if (filter.component !== undefined && e.component !== filter.component) continue;
      if (filter.chatId !== undefined && e.chatId !== filter.chatId) continue;
      if (filter.correlationId !== undefined && e.correlationId !== filter.correlationId) continue;
      if (e.ts) {
        const ts = Date.parse(e.ts);
        if (Number.isFinite(ts) && ts < sinceTs) continue;
      }
      events.push(e);
    }
  }
  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return events.slice(0, limit);
}

export function summarizeObsEvents(events: ObsEvent[]): {
  total: number;
  byEvent: Record<string, number>;
  byComponent: Record<string, number>;
  lastErrors: Array<{ ts: string; event: string; component: string; data?: unknown }>;
} {
  const byEvent: Record<string, number> = {};
  const byComponent: Record<string, number> = {};
  const lastErrors: Array<{ ts: string; event: string; component: string; data?: unknown }> = [];
  for (const e of events) {
    byEvent[e.event] = (byEvent[e.event] ?? 0) + 1;
    byComponent[e.component] = (byComponent[e.component] ?? 0) + 1;
    if (e.level === "error" || e.ok === false) {
      lastErrors.push({ ts: e.ts, event: e.event, component: e.component, data: e.data });
    }
  }
  return {
    total: events.length,
    byEvent,
    byComponent,
    lastErrors: lastErrors.slice(0, 10),
  };
}
