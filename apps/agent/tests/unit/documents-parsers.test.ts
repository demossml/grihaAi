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
