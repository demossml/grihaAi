/**
 * normalizeSupplier — канонизация supplier / category отчёта.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSupplier } from "../../src/services/documents/extractors/normalize-supplier.js";

describe("normalizeSupplier", () => {
  it("«М МАГНИТ» → «Магнит»", () => {
    assert.equal(normalizeSupplier("М МАГНИТ"), "Магнит");
  });

  it("«МАГНИТ (Милан)» → «Магнит»", () => {
    assert.equal(normalizeSupplier("МАГНИТ (Милан)"), "Магнит");
  });

  it("«M МАГНИТ» → «Магнит»", () => {
    assert.equal(normalizeSupplier("M МАГНИТ"), "Магнит");
  });

  it("«Банк Точка БИК 044525104» → «Банк Точка» (canonical раньше junk)", () => {
    assert.equal(normalizeSupplier("Банк Точка БИК 044525104"), "Банк Точка");
  });

  it("«СМОЛЕНСКОЕ ОТДЕЛЕНИЕ №8609 СБЕРБАНК … БИК …» → «Сбербанк»", () => {
    assert.equal(
      normalizeSupplier("СМОЛЕНСКОЕ ОТДЕЛЕНИЕ №8609 СБЕРБАНК 044525225 БИК 044525225"),
      "Сбербанк",
    );
  });

  it("«https //www ozon ru/» → «Ozon» (url, но канонизируется)", () => {
    assert.equal(normalizeSupplier("https //www ozon ru/"), "Ozon");
  });

  it("«Кассовый чек АТОЛ (РМ№2)» → undefined", () => {
    assert.equal(normalizeSupplier("Кассовый чек АТОЛ (РМ№2)"), undefined);
  });

  it("«Товарный чек НОВ00020962» → undefined", () => {
    assert.equal(normalizeSupplier("Товарный чек НОВ00020962"), undefined);
  });

  it("«Покупатель МЯСНИКОВ…» → undefined", () => {
    assert.equal(normalizeSupplier("Покупатель МЯСНИКОВ Сергей"), undefined);
  });

  it("«5 Пятёрочка» → «Пятёрочка»", () => {
    assert.equal(normalizeSupplier("5 Пятёрочка"), "Пятёрочка");
  });

  it("empty / null → undefined", () => {
    assert.equal(normalizeSupplier(""), undefined);
    assert.equal(normalizeSupplier("   "), undefined);
    assert.equal(normalizeSupplier(null), undefined);
    assert.equal(normalizeSupplier(undefined), undefined);
  });

  it("обычный supplier без канона остаётся (trim + slice 80)", () => {
    assert.equal(normalizeSupplier("ООО Ромашка"), "ООО Ромашка");
    assert.equal(normalizeSupplier("  Ромашка  "), "Ромашка");
  });
});
