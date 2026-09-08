import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CapabilityId } from "../../src/utils/capabilities.js";
import {
  SUBAGENT_CAPABILITIES,
  subagentAllowed,
  subagentForbidden,
  isSubagentCapabilityAllowed,
} from "../../src/capabilities/subagent-capabilities.js";

describe("sub-agent capability allowlist", () => {
  it("allows read/analysis capabilities only", () => {
    assert.equal(subagentAllowed("memory.search"), true);
    assert.equal(subagentAllowed("ocr.process"), true);
    assert.equal(subagentAllowed("report.pdf"), true);
  });

  it("forbids write / side-effect / approval-gated capabilities", () => {
    const forbidden: CapabilityId[] = [
      "memory.write",
      "cron.create",
      "telegram.send",
      "finance.pay",
      "multi_agent.delegate",
      "email.send",
    ];
    for (const cap of forbidden) {
      assert.equal(subagentForbidden(cap), true, `${cap} must be forbidden`);
    }
  });

  it("isSubagentCapabilityAllowed reflects the allowlist", () => {
    assert.equal(isSubagentCapabilityAllowed("memory.search"), true);
    assert.equal(isSubagentCapabilityAllowed("memory.write"), false);
  });

  it("allowlist does not accidentally include forbidden entries", () => {
    for (const cap of SUBAGENT_CAPABILITIES) {
      assert.equal(subagentForbidden(cap), false, `${cap} listed as allowed but forbidden`);
    }
  });
});
