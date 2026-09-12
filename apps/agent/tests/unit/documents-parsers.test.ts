import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseDateFromText,
  parseSupplierFromText,
  parseTotalFromText,
  resolvePeriod,
  todayYmd,
  ymdDaysAgo,
} from "../../src/services/documents/extractors/parsers.js";

describe("document parsers", () => {
  it("parseTotalFromText: суммы с валютой и итого", () => {
    assert.equal(parseTotalFromText("чек из Ромашки итого 15400 ₽"), 15400);
    assert.equal(parseTotalFromText("оплачено 1 500,50 руб"), 1500.5);
    assert.equal(parseTotalFromText("сумма: 99.90"), 99.9);
    assert.equal(parseTotalFromText("нет суммы"), undefined);
    assert.equal(parseTotalFromText(""), undefined);
  });

  it("parseTotalFromText R1.1: «Скидка на итог» не итог, ИТОГ: 20515", () => {
    assert.equal(
      parseTotalFromText("Скидка на итог 0.07\nИТОГ: 20515"),
      20515,
      "скидка на итог 0.07 — noise, не total",
    );
  });

  it("parseTotalFromText R1.1: ИТОГ 2437, не НАЛИЧНЫМИ 3037 при СДАЧА", () => {
    assert.equal(
      parseTotalFromText("НАЛИЧНЫМИ 3037\nСДАЧА 600\nИТОГ 2437"),
      2437,
      "при наличии СДАЧА наличные ≠ итог",
    );
    // Без явного ИТОГ и со сдачей — наличные не берём.
    assert.equal(parseTotalFromText("НАЛИЧНЫМИ 3037\nСДАЧА 600"), undefined);
  });

  it("parseTotalFromText R1.1: OCR «ОГ =2437» + СУММА БЕЗ НАС", () => {
    assert.equal(parseTotalFromText("СУММА БЕЗ НАС\nОГ =2437"), 2437);
    assert.equal(parseTotalFromText("ОГ =2437"), 2437);
  });

  it("parseTotalFromText R1.1: НДС 22% не побеждает ИТОГ 96", () => {
    assert.equal(parseTotalFromText("НДС 22%\nИТОГ 96"), 96);
  });

  it("parseTotalFromText R1.1: регрессия сумма: 99.90 руб", () => {
    assert.equal(parseTotalFromText("сумма: 99.90 руб"), 99.9);
  });

  it("parseDateFromText: dd.mm.yyyy и ISO", () => {
    assert.equal(parseDateFromText("накладная от 05.03.2026"), "2026-03-05");
    assert.equal(parseDateFromText("чек 12/08/26"), "2026-08-12");
    assert.equal(parseDateFromText("дата 2026-01-15"), "2026-01-15");
    assert.equal(parseDateFromText("без даты"), undefined);
  });

  it("parseSupplierFromText: «чек из X» / «накладная от X»", () => {
    assert.equal(parseSupplierFromText("чек из Ромашки итого 15400"), "Ромашки");
    assert.equal(parseSupplierFromText("накладная от ООО Ромашка №12"), "ООО Ромашка");
    assert.equal(parseSupplierFromText("invoice from Romashka LLC"), "Romashka LLC");
    assert.equal(parseSupplierFromText("просто текст"), undefined);
  });

  it("resolvePeriod и date helpers", () => {
    assert.equal(ymdDaysAgo(0), todayYmd());
    const p = resolvePeriod("14d");
    assert.match(p.fromDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(p.toDate, todayYmd());
    assert.equal(
      p.fromDate,
      ymdDaysAgo(14),
      "14d — ровно 14 дней назад",
    );
    assert.throws(() => resolvePeriod("1w"), /unknown period/);
  });
});
