import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultFileRoots,
  validateSendFile,
} from "../../.pi/extensions/telegram-bot/file-send.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("send_file production roots", () => {
  it("production (NODE_ENV=production) → только reports/media/artifacts, без cwd/repo/tmp", () => {
    const roots = defaultFileRoots({ NODE_ENV: "production" });
    assert.equal(roots.length, 3);
    assert.ok(
      roots.every((r) => r.endsWith("reports") || r.endsWith("media") || r.endsWith("artifacts")),
      `roots: ${roots.join(", ")}`,
    );
    assert.ok(!roots.includes(path.resolve(process.cwd())), "нет cwd");
    assert.ok(!roots.includes(os.tmpdir()), "нет /tmp");
    assert.ok(!roots.includes(path.resolve(process.cwd(), "../..")), "нет корня монорепо");
  });

  it("GRIHA_STRICT_FILE_ROOTS=1 (даже в dev) → строгие корни", () => {
    const roots = defaultFileRoots({ GRIHA_STRICT_FILE_ROOTS: "1", NODE_ENV: "development" });
    assert.equal(roots.length, 3);
    assert.ok(
      roots.every((r) => r.endsWith("reports") || r.endsWith("media") || r.endsWith("artifacts")),
    );
  });

  it("dev (default) → сохраняет cwd и tmp", () => {
    const roots = defaultFileRoots({});
    assert.ok(roots.includes(path.resolve(process.cwd())), "cwd разрешён в dev");
    assert.ok(roots.includes(os.tmpdir()), "tmp разрешён в dev");
  });

  it("validateSendFile: /etc/passwd → deny", () => {
    const res = validateSendFile("/etc/passwd");
    assert.equal(res.ok, false);
  });

  it("validateSendFile: файл внутри reports → allow (strict fixture)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grish-reports-"));
    tmpDirs.push(dir);
    const reportsDir = path.join(dir, "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const f = path.join(reportsDir, "out.pdf");
    fs.writeFileSync(f, "data");
    const res = validateSendFile(f, { allowedRoots: [reportsDir] });
    assert.equal(res.ok, true);
  });
});
