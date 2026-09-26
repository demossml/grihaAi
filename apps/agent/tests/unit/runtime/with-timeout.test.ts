/**
 * withTimeout + TimeoutError + REPORT_TOOL_TIMEOUTS (report tool-level timeouts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_TOOL_TIMEOUTS,
  TimeoutError,
  withTimeout,
} from "../../../src/runtime/util/with-timeout.js";

describe("withTimeout", () => {
  it("resolves before ms → ok", async () => {
    const result = await withTimeout("t", 500, async () => "ok");
    assert.equal(result, "ok");
  });

  it("exceeds ms → TimeoutError", async () => {
    await assert.rejects(
      () =>
        withTimeout("t", 10, async () => {
          await new Promise((r) => setTimeout(r, 1000));
          return "late";
        }),
      (err) => err instanceof TimeoutError,
    );
  });

  it("TimeoutError несёт code TOOL_TIMEOUT + label + ms", async () => {
    try {
      await withTimeout("report_render", 10, () => new Promise(() => {}));
      assert.fail("expected TimeoutError");
    } catch (err) {
      assert.ok(err instanceof TimeoutError);
      assert.equal((err as TimeoutError).code, "TOOL_TIMEOUT");
      assert.equal((err as TimeoutError).label, "report_render");
      assert.equal((err as TimeoutError).ms, 10);
    }
  });

  it("медленный рендер падает по renderMs, а не ждёт watchdog 300s", async () => {
    // Симуляция зависшего рендера: никогда не резолвится → таймаут срабатывает раньше.
    const started = Date.now();
    await assert.rejects(
      () => withTimeout("report_render", 30, () => new Promise(() => {})),
      (err) => err instanceof TimeoutError,
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `таймаут сработал за ${elapsed}ms, а не 300s`);
  });
});

describe("REPORT_TOOL_TIMEOUTS", () => {
  it("data 30s, render 90s", () => {
    assert.equal(REPORT_TOOL_TIMEOUTS.dataMs, 30_000);
    assert.equal(REPORT_TOOL_TIMEOUTS.renderMs, 90_000);
  });
});
