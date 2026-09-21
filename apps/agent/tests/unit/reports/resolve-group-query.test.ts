/**
 * resolveGroupQuery — название группы → chatId (exact / partial / ambiguous).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGroupQuery } from "../../../src/services/documents/resolveGroupQuery.js";

test("exact title → один chatId", () => {
  const r = resolveGroupQuery("Ремонт", [{ chatId: "-100", chatTitle: "Ремонт" }]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.chatId, "-100");
});

test("case/ё: 'ремонт' совпадает с 'Ремонт'", () => {
  const r = resolveGroupQuery("ремонт", [{ chatId: "-100", chatTitle: "Ремонт" }]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.chatId, "-100");
});

test("partial один матч → ok", () => {
  const r = resolveGroupQuery("ремонт", [{ chatId: "-100", chatTitle: "Ремонт квартиры" }]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.chatId, "-100");
});

test("partial два матча → AMBIGUOUS + candidates", () => {
  const r = resolveGroupQuery("ремонт", [
    { chatId: "-100", chatTitle: "Ремонт квартиры" },
    { chatId: "-200", chatTitle: "Ремонт дачи" },
  ]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "AMBIGUOUS");
  assert.equal(r.candidates!.length, 2);
});

test("нет матчей → NOT_FOUND", () => {
  const r = resolveGroupQuery("xyz", [{ chatId: "-100", chatTitle: "Ремонт" }]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "NOT_FOUND");
});

test("empty query → EMPTY_QUERY", () => {
  const r = resolveGroupQuery("  ", [{ chatId: "-100", chatTitle: "Ремонт" }]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "EMPTY_QUERY");
});
