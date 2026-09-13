/**
 * Item 11.3 (K3): безопасность файловых путей.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkFileOperation,
  isSafePath,
} from "../../src/runtime/security/files.js";

const ROOTS = ["/home/grisha/workspace", "/tmp/jobs"];

describe("File path safety (Item 11.3)", () => {
  it("относительный путь без .. → безопасен", () => {
    assert.equal(isSafePath("docs/report.md", ROOTS), true);
  });

  it(".. traversal → небезопасен", () => {
    assert.equal(isSafePath("../etc/passwd", ROOTS), false);
    assert.equal(isSafePath("a/../../b", ROOTS), false);
  });

  it("абсолютный путь в корне → безопасен, вне корней → нет", () => {
    assert.equal(isSafePath("/home/grisha/workspace/x.md", ROOTS), true);
    assert.equal(isSafePath("/etc/passwd", ROOTS), false);
  });

  it("checkFileOperation: небезопасный путь → safe=false + risk по операции", () => {
    const result = checkFileOperation({ operation: "write", path: "/etc/passwd" }, ROOTS);
    assert.equal(result.safe, false);
    assert.equal(result.risk.level, "medium");
    const del = checkFileOperation({ operation: "delete", path: "/etc/passwd" }, ROOTS);
    assert.equal(del.risk.level, "high");
  });

  it("checkFileOperation: безопасный путь → safe=true", () => {
    const result = checkFileOperation({ operation: "read", path: "notes.md" }, ROOTS);
    assert.equal(result.safe, true);
    assert.equal(result.risk.level, "safe");
  });
});
