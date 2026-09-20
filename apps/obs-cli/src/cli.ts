import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { defaultObsDir, type ObsEvent } from "@griha/observability";

const USAGE = `Usage:
  griha-obs tail [--dir <path>] [--lines <N>]
  griha-obs query --event <name> [--component <c>] [--chat-id <id>] [--dir <path>] [--limit <N>]
  griha-obs path

Commands:
  tail    print last N raw JSONL lines (default 50)
  query   filter events by field, print matching JSON lines
  path    print defaultObsDir()

Options:
  --dir <path>      obs dir (default: defaultObsDir())
  --lines <N>       tail: number of lines (default 50)
  --event <name>    query: exact event name
  --component <c>   query: exact component
  --chat-id <id>    query: exact chatId
  --limit <N>       query: max results (default 50)
  -h, --help        show this help
`;

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function listEventFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"))
      .sort();
  } catch {
    return [];
  }
}

function readRawLines(dir: string): string[] {
  const lines: string[] = [];
  for (const f of listEventFiles(dir)) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim() !== "") lines.push(line);
    }
  }
  return lines;
}

function readEvents(dir: string): ObsEvent[] {
  const events: ObsEvent[] = [];
  for (const line of readRawLines(dir)) {
    try {
      events.push(JSON.parse(line) as ObsEvent);
    } catch {
      /* skip bad line */
    }
  }
  return events;
}

function toInt(v: string | boolean | undefined, def: number): number {
  if (typeof v !== "string" || v.trim() === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export async function run(argv: string[], io: CliIO): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];

  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: "string" },
        lines: { type: "string" },
        event: { type: "string" },
        component: { type: "string" },
        "chat-id": { type: "string" },
        limit: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values as Record<string, string | boolean | undefined>;
    positionals = parsed.positionals;
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const command = positionals[0];

  if (values.help || command === undefined) {
    io.stdout(USAGE);
    return values.help ? 0 : 1;
  }

  const dir = typeof values.dir === "string" && values.dir !== "" ? values.dir : defaultObsDir();

  if (command === "path") {
    io.stdout(defaultObsDir());
    return 0;
  }

  if (command === "tail") {
    const n = Math.max(1, toInt(values.lines, 50));
    const lines = readRawLines(dir);
    for (const line of lines.slice(-n)) io.stdout(line);
    return 0;
  }

  if (command === "query") {
    const event = typeof values.event === "string" ? values.event : undefined;
    const component = typeof values.component === "string" ? values.component : undefined;
    const chatId = typeof values["chat-id"] === "string" ? values["chat-id"] : undefined;
    const limit = Math.max(1, toInt(values.limit, 50));

    const events = readEvents(dir).filter((e) => {
      if (event !== undefined && e.event !== event) return false;
      if (component !== undefined && e.component !== component) return false;
      if (chatId !== undefined && e.chatId !== chatId) return false;
      return true;
    });

    // Свежие первыми.
    events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    for (const e of events.slice(0, limit)) io.stdout(JSON.stringify(e));
    return 0;
  }

  io.stderr(`unknown command: ${command}`);
  return 1;
}
