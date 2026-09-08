/**
 * Synthetic memory dataset (1200 records, 110 queries) for the retrieval
 * benchmark. Deterministic (seeded PRNG). Categories A–G per the audit spec.
 */
import { mulberry32 } from "./lib.js";

export interface DatasetRecord {
  key: string;
  content: string;
  category: string;
  projectId?: string;
  botId?: string;
  metadata?: Record<string, unknown>;
  /** ISO date override for temporal facts (inserted via SQL). */
  date?: string;
}

export interface DatasetQuery {
  id: string;
  kind: string;
  query: string;
  /** Record keys that are relevant (ground truth). */
  relevant: string[];
  filters?: { projectId?: string; category?: string };
}

export interface Dataset {
  records: DatasetRecord[];
  queries: DatasetQuery[];
}

const TOPICS = [
  "programming language", "backend framework", "database", "cloud provider",
  "communication style", "meeting schedule", "reporting format", "preferred editor",
];

const DISTRACTOR_WORDS = [
  "recipe", "garden", "weather", "movie", "book", "sport", "music", "painting",
  "woodworking", "travel", "gaming", "cooking", "cycling", "fishing", "astronomy",
];

function topicValue(topic: string, idx: number): string {
  const values: Record<string, string[]> = {
    "programming language": ["TypeScript", "Python", "Go", "Rust", "Kotlin"],
    "backend framework": ["NestJS", "FastAPI", "Express", "Gin", "Actix"],
    "database": ["PostgreSQL", "SQLite", "MySQL", "MongoDB", "ClickHouse"],
    "cloud provider": ["Cloudflare", "AWS", "GCP", "Azure", "Hetzner"],
    "communication style": ["short answers", "detailed explanations", "bullet lists", "formal tone", "informal tone"],
    "meeting schedule": ["Monday 09:00", "Tuesday 15:00", "Wednesday 11:00", "Thursday 14:00", "Friday 10:00"],
    "reporting format": ["PDF", "PPTX", "Markdown", "HTML", "CSV"],
    "preferred editor": ["VS Code", "Neovim", "IntelliJ IDEA", "Emacs", "Zed"],
  };
  const list = values[topic] ?? ["value"];
  return list[idx % list.length];
}

export function buildDataset(seed = 20260908): Dataset {
  const rng = mulberry32(seed);
  const records: DatasetRecord[] = [];
  const queries: DatasetQuery[] = [];

  // A — exact facts (100)
  for (let i = 0; i < 100; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const value = topicValue(topic, Math.floor(rng() * 5));
    const content = `User's preferred ${topic} is ${value}.`;
    records.push({ key: `a${i}`, content, category: "preference" });
  }
  // A queries: exact copy of the fact text.
  for (let i = 0; i < 20; i++) {
    const r = records[Math.floor(rng() * 100)];
    queries.push({ id: `qa${i}`, kind: "exact", query: r.content, relevant: [r.key] });
  }

  // B — semantic paraphrases (100) in 20 groups × 5 paraphrases.
  for (let g = 0; g < 20; g++) {
    const topic = TOPICS[g % TOPICS.length];
    const value = topicValue(topic, Math.floor(rng() * 5));
    const variants = [
      `User's preferred ${topic} is ${value}.`,
      `User usually works with ${value} for ${topic}.`,
      `For ${topic}, the user chose ${value}.`,
      `The user tends to use ${value} when it comes to ${topic}.`,
      `User's go-to ${topic} is ${value}.`,
    ];
    for (let v = 0; v < 5; v++) {
      records.push({ key: `b${g}_${v}`, content: variants[v], category: "preference" });
    }
    queries.push({
      id: `qb${g}`,
      kind: "semantic",
      query: `What does the user prefer for ${topic}?`,
      relevant: [0, 1, 2, 3, 4].map((v) => `b${g}_${v}`),
    });
  }

  // C — temporal facts (100): every (month, topic) pair has exactly 2 records.
  const months = ["January", "March", "June", "September", "December"];
  for (let m = 0; m < months.length; m++) {
    for (let t = 0; t < TOPICS.length; t++) {
      const topic = TOPICS[t];
      const v1 = topicValue(topic, m % 5);
      const v2 = topicValue(topic, (m + 2) % 5);
      const month = months[m];
      records.push({
        key: `c${m}_${t}_1`,
        content: `In ${month} user used ${v1} for ${topic}.`,
        category: "fact",
        metadata: { month },
      });
      records.push({
        key: `c${m}_${t}_2`,
        content: `In ${month} user used ${v2} for ${topic}.`,
        category: "fact",
        metadata: { month },
      });
    }
  }
  for (let i = 0; i < 15; i++) {
    const m = i % months.length;
    const t = i % TOPICS.length;
    const month = months[m];
    const topic = TOPICS[t];
    queries.push({
      id: `qc${i}`,
      kind: "temporal",
      query: `What did the user use for ${topic} in ${month}?`,
      relevant: [`c${m}_${t}_1`, `c${m}_${t}_2`],
    });
  }

  // D — contradictory memories (100 = 50 old/new pairs)
  for (let p = 0; p < 50; p++) {
    const topic = TOPICS[p % TOPICS.length];
    const oldV = topicValue(topic, p % 5);
    const newV = topicValue(topic, (p + 1) % 5);
    records.push({ key: `d${p}_old`, content: `User prefers ${oldV} for ${topic}.`, category: "preference", metadata: { date: "2026-01" } });
    records.push({ key: `d${p}_new`, content: `User migrated from ${oldV} to ${newV} for ${topic}.`, category: "preference", metadata: { date: "2026-09" } });
    queries.push({
      id: `qd${p}`,
      kind: "contradiction",
      query: `What does the user currently use for ${topic}?`,
      relevant: [`d${p}_new`],
    });
  }

  // E — near duplicates (100 = 50 clusters × 2)
  for (let c = 0; c < 50; c++) {
    const topic = TOPICS[c % TOPICS.length];
    const value = topicValue(topic, Math.floor(rng() * 5));
    const base = `User prefers ${value} for ${topic}`;
    records.push({ key: `e${c}_1`, content: `${base}.`, category: "preference" });
    records.push({ key: `e${c}_2`, content: `${base} — confirmed again.`, category: "preference" });
    queries.push({
      id: `qe${c}`,
      kind: "near-duplicate",
      query: base,
      relevant: [`e${c}_1`, `e${c}_2`],
    });
  }

  // F — unrelated distractors (600)
  for (let i = 0; i < 600; i++) {
    const w1 = DISTRACTOR_WORDS[Math.floor(rng() * DISTRACTOR_WORDS.length)];
    const w2 = DISTRACTOR_WORDS[Math.floor(rng() * DISTRACTOR_WORDS.length)];
    records.push({ key: `f${i}`, content: `${w1} note ${i}: user likes ${w2} activities.`, category: "other" });
  }
  // noise queries: distractors are never relevant.
  for (let i = 0; i < 10; i++) {
    const w = DISTRACTOR_WORDS[i];
    queries.push({ id: `qf${i}`, kind: "noisy", query: `User's ${w} preferences`, relevant: [] });
  }

  // G — multi-hop facts (100: project → db / cloud / architecture)
  const projects = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
  for (let i = 0; i < 100; i++) {
    const proj = projects[i % projects.length];
    const kind = i % 3;
    const content =
      kind === 0
        ? `Project ${proj} uses ${topicValue(rng, Math.floor(rng() * 5))} as its database.`
        : kind === 1
          ? `Project ${proj} is deployed on ${topicValue(rng, Math.floor(rng() * 5))}.`
          : `Project ${proj} made an architecture decision to use event-driven design.`;
    records.push({ key: `g${i}`, content, category: "fact", metadata: { project: proj } });
  }
  for (let i = 0; i < 10; i++) {
    const proj = projects[i % projects.length];
    const dbRecords = records
      .filter((r) => r.key.startsWith("g") && r.content.includes(`Project ${proj} uses `))
      .map((r) => r.key);
    queries.push({
      id: `qg${i}`,
      kind: "multi-hop",
      query: `Which database does Project ${proj} use?`,
      relevant: dbRecords,
    });
  }

  // metadata filtering (10): a separate project with known facts.
  for (let i = 0; i < 40; i++) {
    records.push({
      key: `m${i}`,
      content: `Project Meta fact ${i}: prefers ${topicValue(rng, i % 5)}.`,
      category: "fact",
      projectId: "meta-project",
    });
  }
  for (let i = 0; i < 10; i++) {
    queries.push({
      id: `qm${i}`,
      kind: "metadata-filter",
      query: `Meta fact ${i * 4} prefers`,
      relevant: [`m${i * 4}`],
      filters: { projectId: "meta-project" },
    });
  }

  return { records, queries };
}
