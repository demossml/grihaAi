import { test } from "node:test";
import assert from "node:assert/strict";
import { previewText, parseItemsJson } from "./format.js";

test("previewText: null/empty → null", () => {
  assert.equal(previewText(null), null);
  assert.equal(previewText(undefined), null);
  assert.equal(previewText(""), null);
  assert.equal(previewText("   "), null);
});

test("previewText: короткий без обрезки, длинный с …", () => {
  assert.equal(previewText("привет"), "привет");
  const long = "x".repeat(300);
  const out = previewText(long, 200);
  assert.equal(out!.length, 201);
  assert.ok(out!.endsWith("…"));
});

test("previewText: схлопывает пробелы", () => {
  assert.equal(previewText("  a   b  "), "a b");
});

test("parseItemsJson: валидный массив", () => {
  const items = parseItemsJson(JSON.stringify([{ name: "Кабель", qty: 45, sum: 178 }, { name: "Розетка" }]));
  assert.equal(items.length, 2);
  assert.equal(items[0].name, "Кабель");
  assert.equal(items[0].qty, 45);
  assert.equal(items[0].sum, 178);
  assert.equal(items[1].name, "Розетка");
  assert.equal(items[1].qty, undefined);
});

test("parseItemsJson: invalid/null/не-массив → []", () => {
  assert.deepEqual(parseItemsJson(null), []);
  assert.deepEqual(parseItemsJson("not json"), []);
  assert.deepEqual(parseItemsJson('{"a":1}'), []);
  assert.deepEqual(parseItemsJson(JSON.stringify([{ bad: 1 }])), []);
});
