import { before } from "node:test";
import path from "node:path";
import fs from "node:fs";

const TEST_DB_DIR = path.join(process.cwd(), "tests", ".tmp-db");

export function getTestDbPath(name = "test.sqlite"): string {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  return path.join(TEST_DB_DIR, name);
}

export function cleanTestDb(name = "test.sqlite"): void {
  const p = getTestDbPath(name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  for (const s of ["-wal", "-shm"]) {
    const e = p + s;
    if (fs.existsSync(e)) fs.unlinkSync(e);
  }
}

before(() => {
  // Only ensure the directory exists. Do NOT wipe it — test files run in
  // parallel processes and removing the shared dir races with other files
  // that are still writing their (uniquely named) DB files into it.
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
});
