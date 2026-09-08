import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rotateBackups } from "../../scripts/backup.js";

describe("backup rotation", () => {
  it("keeps the N newest backups and removes the rest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-rot-"));
    try {
      for (let i = 1; i <= 10; i++) {
        fs.mkdirSync(path.join(dir, `2026-09-0${i % 10}T00-00-00-000Z`));
      }
      const { kept, removed } = rotateBackups(dir, 7);

      assert.equal(kept.length, 7);
      assert.equal(removed.length, 3);
      const remaining = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      assert.equal(remaining.length, 7);
      for (const name of removed) {
        assert.ok(!remaining.includes(name));
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes nothing when there are fewer backups than keep", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-rot-"));
    try {
      fs.mkdirSync(path.join(dir, "2026-09-01T00-00-00-000Z"));
      fs.mkdirSync(path.join(dir, "2026-09-02T00-00-00-000Z"));
      const { kept, removed } = rotateBackups(dir, 7);

      assert.equal(kept.length, 2);
      assert.equal(removed.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
