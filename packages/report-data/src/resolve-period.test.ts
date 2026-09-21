import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReportPeriod, isValidYmd } from "./resolve-period.js";

test("нет period → fullHistory true", () => {
  assert.deepEqual(resolveReportPeriod(undefined), {
    fromDate: null,
    toDate: null,
    fullHistory: true,
  });
  assert.deepEqual(resolveReportPeriod({}), { fromDate: null, toDate: null, fullHistory: true });
});

test("from+to → fullHistory false", () => {
  const r = resolveReportPeriod({ fromDate: "2026-09-01", toDate: "2026-09-20" });
  assert.deepEqual(r, { fromDate: "2026-09-01", toDate: "2026-09-20", fullHistory: false });
});

test("isValidYmd", () => {
  assert.equal(isValidYmd("2026-09-01"), true);
  assert.equal(isValidYmd("2026-9-1"), false);
  assert.equal(isValidYmd("abc"), false);
  assert.equal(isValidYmd(""), false);
});
