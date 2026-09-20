import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ObsEvent, ObsSink } from "./types.js";

export function defaultObsDir(): string {
  return (
    process.env.GRIHA_OBS_DIR ??
    path.join(process.env.GRIHA_HOME ?? path.join(os.homedir(), ".grish-ai"), "obs")
  );
}

export function createJsonlSink(opts?: { dir?: string }): ObsSink {
  const dir = opts?.dir ?? defaultObsDir();
  fs.mkdirSync(dir, { recursive: true });
  return {
    write(event: ObsEvent) {
      const day = event.ts.slice(0, 10); // YYYY-MM-DD
      const file = path.join(dir, `events-${day}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
    },
  };
}
