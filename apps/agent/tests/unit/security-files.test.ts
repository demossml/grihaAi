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
  it("абсолютный путь в корне → безопасен, вне корней → нет", () => {
    assert.equal(isSafePath("/home/grisha/workspace/x.md", ROOTS), true);
    assert.equal(isSafePath("/home/grisha/workspace", ROOTS), true);
    assert.equal(isSafePath("/etc/passwd", ROOTS), false);
  });

  it(".. traversal → небезопасен", () => {
    assert.equal(isSafePath("../etc/passwd", ROOTS), false);
    assert.equal(isSafePath("/home/grisha/workspace/../../etc/passwd", ROOTS), false);
  });

  it("~ home и UNC → небезопасны", () => {
    assert.equal(isSafePath("~/.ssh/id_rsa", ROOTS), false);
    assert.equal(isSafePath("\\\\server\\share\\x", ROOTS), false);
    assert.equal(isSafePath("//server/share/x", ROOTS), false);
  });

  it("пустой/пробельный путь → небезопасен", () => {
    assert.equal(isSafePath("   ", ROOTS), false);
    assert.equal(isSafePath("", ROOTS), false);
  });

  it("checkFileOperation: небезопасный путь → safe=false + risk по операции", () => {
    const result = checkFileOperation({ operation: "write", path: "/etc/passwd" }, ROOTS);
    assert.equal(result.safe, false);
    assert.equal(result.risk.level, "medium");
    const del = checkFileOperation({ operation: "delete", path: "/etc/passwd" }, ROOTS);
    assert.equal(del.risk.level, "high");
  });

  it("checkFileOperation: безопасный путь → safe=true", () => {
    const result = checkFileOperation({ operation: "read", path: "/home/grisha/workspace/notes.md" }, ROOTS);
    assert.equal(result.safe, true);
    assert.equal(result.risk.level, "safe");
  });
});
