/**
 * Хардненинг парсера чеков: ИТОГО-якоря, отбрасывание ИНН, диапазон дат,
 * служебные строки («КАССОВЫЙ ЧЕК»/«ПОБЕДА ООО») не становятся позициями.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTotalFromText,
  parseDateFromText,
  parseSupplierFromText,
  parseItemsFromText,
  computeNeedsReview,
} from "../../src/services/documents/extractors/parsers.js";

describe("receipt parser hardening", () => {
  it("F1: ИТОГО.....6767.00 → 6767", () => {
    assert.equal(parseTotalFromText("ИТОГО.....6767.00"), 6767);
    assert.equal(parseTotalFromText("ВСЕГО К ОПЛАТЕ: 6767.00"), 6767);
    assert.equal(parseTotalFromText("ИТОГ К ОПЛАТЕ = 6 767"), 6767);
  });

  it("F1b: якорь приоритетнее голого «сумма НДС»", () => {
    const text = "СУММА НДС 123.00\nИТОГО 599.60";
    assert.equal(parseTotalFromText(text), 599.6);
  });

  it("F2: строка с ИНН 7717664244 + ИТОГО 599.60 → total 599.60", () => {
    const text = [
      'ООО "ПОБЕДА"',
      "ИНН 7717664244",
      "КАССОВЫЙ ЧЕК",
      "Хлеб 50.00",
      "Молоко 549.60",
      "ИТОГО 599.60",
    ].join("\n");

    assert.equal(parseTotalFromText(text), 599.6);

    const items = parseItemsFromText(text);
    const names = items.map((i) => i.name);
    assert.ok(names.includes("Хлеб"), "Хлеб есть");
    assert.ok(names.includes("Молоко"), "Молоко есть");
    assert.ok(!names.some((n) => /ИНН|КАССОВЫЙ ЧЕК|ПОБЕДА/i.test(n)), "нет ИНН/КАССОВЫЙ ЧЕК/ПОБЕДА");
    assert.ok(!items.some((i) => i.sum === 7717664244), "ИНН не стал суммой позиции");
  });

  it("F2b: total не берётся из строки с ИНН", () => {
    assert.equal(parseTotalFromText("ИНН 7717664244"), undefined);
    assert.equal(parseTotalFromText("сумма: 7717664244"), undefined);
  });

  it("F3: дата вне диапазона → undefined (мусор OCR)", () => {
    const currentYear = new Date().getFullYear();
    assert.equal(parseDateFromText("дата 2035-07-02"), undefined);
    assert.equal(parseDateFromText("дата 1990-01-01"), undefined);
    assert.equal(parseDateFromText(`дата ${currentYear}-01-15`), `${currentYear}-01-15`);
  });

  it("F4: «КАССОВЫЙ ЧЕК» / «ПОБЕДА ООО» без цены → не позиции", () => {
    const text = [
      "ПОБЕДА ООО",
      "КАССОВЫЙ ЧЕК",
      "Хлеб 50.00",
    ].join("\n");
    const items = parseItemsFromText(text);
    const names = items.map((i) => i.name);
    assert.ok(!names.some((n) => /КАССОВЫЙ ЧЕК|ПОБЕДА/i.test(n)), "служебные строки не позиции");
    assert.ok(names.includes("Хлеб"));
  });

  it("supplier: маркер юрлица в первых строках OCR", () => {
    assert.equal(parseSupplierFromText('ООО "Ромашка"\nИНН 123\nИТОГО 100'), "Ромашка");
    assert.equal(parseSupplierFromText("МАГНИТ\nКассовый чек\nИТОГО 50"), "МАГНИТ");
  });

  it("computeNeedsReview: пустые total/supplier/date → true", () => {
    assert.equal(computeNeedsReview({ total: undefined, supplier: undefined, docDate: undefined }), true);
    assert.equal(
      computeNeedsReview({ total: 100, supplier: "X", docDate: "2026-01-01", items: [{ name: "a", sum: 1 }] }),
      false,
    );
    assert.equal(
      computeNeedsReview({ total: 100, supplier: "X", docDate: "2026-01-01", items: [], rawText: "x".repeat(100) }),
      true,
    );
  });
});
