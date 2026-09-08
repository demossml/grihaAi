import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityAvailable,
  describeLimitation,
  capabilitiesReport,
  getCapabilityStatus,
} from "../../src/utils/capabilities.js";

describe("capability registry", () => {
  it("reports external capabilities as requiring a connection", () => {
    assert.equal(getCapabilityStatus("email.send"), "REQUIRES_CONNECTION");
    assert.equal(getCapabilityStatus("calendar.write"), "REQUIRES_CONNECTION");
    assert.equal(getCapabilityStatus("travel.book"), "REQUIRES_CONNECTION");
    assert.equal(capabilityAvailable("email.send"), false);
  });

  it("reports internal capabilities as available", () => {
    assert.equal(getCapabilityStatus("memory.search"), "AVAILABLE");
    assert.equal(getCapabilityStatus("cron.create"), "AVAILABLE");
    assert.equal(getCapabilityStatus("stt.transcribe"), "AVAILABLE");
    assert.equal(getCapabilityStatus("report.pdf"), "AVAILABLE");
    assert.equal(capabilityAvailable("memory.write"), true);
  });

  it("marks approval-gated capabilities", () => {
    assert.equal(getCapabilityStatus("finance.pay"), "REQUIRES_APPROVAL");
  });

  it("returns a clear limitation message", () => {
    assert.match(describeLimitation("email.send"), /не подключён/);
    assert.match(describeLimitation("travel.book"), /недоступно/);
  });

  it("produces a machine-readable report with degraded skills", () => {
    const report = capabilitiesReport();
    assert.equal(report.capabilities["email.send"], "REQUIRES_CONNECTION");
    assert.ok(report.degradedSkills.includes("correspondence"));
    assert.ok(report.degradedSkills.includes("travel-coordination"));
    assert.ok(report.approvalRequiredActions.includes("email.send"));
    assert.ok(report.approvalRequiredActions.includes("finance.pay"));
  });
});
