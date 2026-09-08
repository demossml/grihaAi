import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateToolCall } from "../../src/utils/gateway-policy.js";

describe("gateway policy", () => {
  it("allows everything in trusted sessions", () => {
    for (const tool of ["bash", "write", "edit", "read", "grep", "delegate_tasks"]) {
      assert.equal(evaluateToolCall(tool, "trusted").allow, true, tool);
    }
  });

  it("blocks shell execution in untrusted sessions", () => {
    assert.equal(evaluateToolCall("bash", "untrusted").allow, false);
    assert.equal(evaluateToolCall("powershell", "untrusted").allow, false);
  });

  it("blocks file mutation in untrusted sessions", () => {
    assert.equal(evaluateToolCall("write", "untrusted").allow, false);
    assert.equal(evaluateToolCall("edit", "untrusted").allow, false);
  });

  it("allows read-only tools in untrusted sessions", () => {
    for (const tool of ["read", "grep", "find", "ls"]) {
      assert.equal(evaluateToolCall(tool, "untrusted").allow, true, tool);
    }
  });

  it("allows safe custom tools in untrusted sessions", () => {
    assert.equal(evaluateToolCall("analyze_image", "untrusted").allow, true);
  });
});
