import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityAvailable,
  describeLimitation,
  capabilitiesReport,
} from "../../src/utils/capabilities.js";

describe("connector capabilities", () => {
  it("reports all external capabilities as absent", () => {
    assert.equal(capabilityAvailable("email.send"), false);
    assert.equal(capabilityAvailable("calendar.write"), false);
    assert.equal(capabilityAvailable("travel.book"), false);
  });

  it("returns a clear limitation message", () => {
    assert.match(describeLimitation("email.send"), /не подключён/);
    assert.match(describeLimitation("travel.book"), /недоступно/);
  });

  it("produces a machine-readable report with degraded skills", () => {
    const report = capabilitiesReport();
    assert.equal(typeof report.capabilities["email.send"], "boolean");
    assert.ok(report.degradedSkills.includes("correspondence"));
    assert.ok(report.degradedSkills.includes("travel-coordination"));
    assert.ok(report.approvalRequiredActions.includes("email.send"));
    assert.ok(report.approvalRequiredActions.includes("invoice.pay"));
  });
});
