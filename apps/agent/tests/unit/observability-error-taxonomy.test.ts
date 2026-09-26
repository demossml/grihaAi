/**
 * Prompt 06 — таксономия ошибок + primaryFailure + failureChain.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categoryForCode,
  codeFromRenderError,
  codeFromTurnCode,
} from "../../src/runtime/observability/error-taxonomy.js";
import { TraceManager } from "../../src/runtime/observability/trace.js";

describe("codeFromTurnCode (Prompt 06)", () => {
  it("timeout → TOOL_TIMEOUT", () => {
    assert.equal(codeFromTurnCode("timeout"), "TOOL_TIMEOUT");
  });
  it("prompt_error → MODEL_ERROR", () => {
    assert.equal(codeFromTurnCode("prompt_error"), "MODEL_ERROR");
  });
  it("неизвестный → UNKNOWN", () => {
    assert.equal(codeFromTurnCode("что-то ещё"), "UNKNOWN");
  });
  it("TOOL_TIMEOUT отличается от TOOL_ERROR", () => {
    assert.notEqual(codeFromTurnCode("timeout"), "TOOL_ERROR");
    assert.equal(codeFromTurnCode("timeout"), "TOOL_TIMEOUT");
  });
});

describe("codeFromRenderError (Prompt 06)", () => {
  it("schema mismatch INVALID_INPUT → REPORT_ERROR", () => {
    assert.equal(codeFromRenderError("INVALID_INPUT"), "REPORT_ERROR");
  });
  it("UNKNOWN_TEMPLATE / RENDER_FAILED / WRITE_FAILED → REPORT_ERROR", () => {
    assert.equal(codeFromRenderError("UNKNOWN_TEMPLATE"), "REPORT_ERROR");
    assert.equal(codeFromRenderError("RENDER_FAILED"), "REPORT_ERROR");
    assert.equal(codeFromRenderError("WRITE_FAILED"), "REPORT_ERROR");
  });
  it("INTERNAL → UNKNOWN", () => {
    assert.equal(codeFromRenderError("INTERNAL"), "UNKNOWN");
  });
});

describe("categoryForCode (Prompt 06)", () => {
  it("коды распределены по коарс-категориям", () => {
    assert.equal(categoryForCode("TOOL_TIMEOUT"), "execution");
    assert.equal(categoryForCode("MODEL_ERROR"), "execution");
    assert.equal(categoryForCode("RETRIEVAL_EMPTY"), "context");
    assert.equal(categoryForCode("REPORT_ERROR"), "media");
    assert.equal(categoryForCode("OCR_ERROR"), "media");
    assert.equal(categoryForCode("TELEGRAM_ERROR"), "telegram");
    assert.equal(categoryForCode("PERSISTENCE_ERROR"), "persistence");
    assert.equal(categoryForCode("UNKNOWN"), "unknown");
  });
});

describe("primaryFailure + failureChain (Prompt 06)", () => {
  it("failed trace содержит primaryFailure с правильным кодом", () => {
    const m = new TraceManager({ now: () => "2026-01-01T00:00:00.000Z" });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    m.addStep({ type: "model", status: "failed" });
    const code = codeFromTurnCode("timeout");
    m.setFailure({ category: categoryForCode(code), code, explanation: "timeout" });
    m.finish("failed", { success: false, errorCode: "timeout" });

    assert.equal(m.current?.status, "failed");
    assert.equal(m.current?.primaryFailure?.code, "TOOL_TIMEOUT");
    assert.equal(m.current?.primaryFailure?.category, "execution");
  });

  it("failureChain отражает последовательность failed-шагов", () => {
    const m = new TraceManager({ now: () => "2026-01-01T00:00:00.000Z" });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    m.addStep({ type: "retrieval", status: "success" });
    const failedModel = m.addStep({ type: "model", status: "failed" });
    const validation = m.addStep({ type: "validation", status: "failed" });

    m.setFailure(
      { category: "execution", code: "MODEL_ERROR" },
      [
        { stepId: failedModel.stepId, stepType: "model", code: "MODEL_ERROR" },
        { stepId: validation.stepId, stepType: "validation", code: "VALIDATION_ERROR" },
      ],
    );
    m.finish("failed", { success: false, errorCode: "prompt_error" });

    assert.equal(m.current?.failureChain?.length, 2);
    assert.equal(m.current?.failureChain?.[0].stepId, failedModel.stepId);
    assert.equal(m.current?.failureChain?.[1].stepType, "validation");
  });
});
