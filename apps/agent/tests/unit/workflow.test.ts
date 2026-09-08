import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MEETING_WORKFLOW,
  FINANCE_WORKFLOW,
  getWorkflow,
  listWorkflows,
  nextStep,
  workflowCapabilities,
} from "../../src/workflow/workflows.js";

describe("workflow layer", () => {
  it("lists the known workflows", () => {
    const names = listWorkflows().map((w) => w.name);
    assert.ok(names.includes("meeting"));
    assert.ok(names.includes("finance"));
  });

  it("gets a workflow by name", () => {
    assert.equal(getWorkflow("meeting"), MEETING_WORKFLOW);
    assert.equal(getWorkflow("unknown"), undefined);
  });

  it("computes the deterministic next step", () => {
    const step = nextStep(MEETING_WORKFLOW, "prepare");
    assert.equal(step?.id, "meeting");
    assert.equal(nextStep(MEETING_WORKFLOW, "track"), undefined);
    assert.equal(nextStep(MEETING_WORKFLOW, "nope"), undefined);
  });

  it("derives capabilities in step order without duplicates", () => {
    const caps = workflowCapabilities(FINANCE_WORKFLOW);
    assert.ok(caps.includes("ocr.process"));
    assert.ok(caps.includes("finance.pay"));
    assert.equal(new Set(caps).size, caps.length);
  });
});
