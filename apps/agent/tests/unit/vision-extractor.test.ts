import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StubExtractor,
  VisionExtractor,
  createExtractor,
  type VisionOcrFn,
} from "../../src/services/documents/extractors/types.js";
import { detectKind } from "../../src/services/documents/extractors/parsers.js";

describe("createExtractor (vision vs stub)", () => {
  it("без vision-ключа → StubExtractor (честный offline)", () => {
    const e = createExtractor(undefined, false);
    assert.ok(e instanceof StubExtractor);
  });

  it("ключ есть, но visionOcr не собран → StubExtractor (не падает)", () => {
    const e = createExtractor({ provider: "vision" }, true);
    assert.ok(e instanceof StubExtractor);
  });

  it("ключ + visionOcr → VisionExtractor", () => {
    const mockOcr: VisionOcrFn = async () => "text";
    const e = createExtractor(undefined, true, mockOcr);
    assert.ok(e instanceof VisionExtractor);
  });
});

describe("VisionExtractor", () => {
  it("OCR «Итог = 125.00, чек из Ромашки» → total=125, kind=receipt, confidence≥0.4", async () => {
    const mockOcr: VisionOcrFn = async () => "Магазин Ромашка\nИтог = 125.00 руб\nчек из Ромашка";
    const extractor = new VisionExtractor(mockOcr);
    const res = await extractor.extract({
      filePath: "/tmp/fake.jpg",
      mimeType: "image/jpeg",
      caption: "",
    });
    assert.equal(res.total, 125);
    assert.equal(res.kind, "receipt");
    assert.ok(res.confidence >= 0.4);
    assert.equal(res.needsReview, false);
    assert.equal(res.supplier, "Ромашка");
    assert.ok(res.rawText!.includes("Итог"));
  });

  it("накладная → kind=waybill; счёт → invoice", async () => {
    const waybill = new VisionExtractor(async () => "Товарная накладная №5\nИтого 500 руб");
    assert.equal((await waybill.extract({ filePath: "/tmp/f" })).kind, "waybill");
    const invoice = new VisionExtractor(async () => "Счёт на оплату №2\nСумма 300 руб");
    assert.equal((await invoice.extract({ filePath: "/tmp/f" })).kind, "invoice");
  });

  it("OCR без суммы → needsReview=true, kind=unknown, честный confidence 0.55", async () => {
    const extractor = new VisionExtractor(async () => "какой-то текст без денег");
    const res = await extractor.extract({ filePath: "/tmp/f" });
    assert.equal(res.total, undefined);
    assert.equal(res.needsReview, true);
    assert.equal(res.kind, "unknown");
    assert.equal(res.confidence, 0.55);
  });

  it("caption-парсинг дополняет OCR (fallback сумма из caption)", async () => {
    const extractor = new VisionExtractor(async () => "чек");
    const res = await extractor.extract({
      filePath: "/tmp/f",
      caption: "сумма 400 руб",
    });
    assert.equal(res.total, 400);
  });

  it("visionOcr бросил → needsReview, extract НЕ бросает (caller живёт)", async () => {
    const extractor = new VisionExtractor(async () => {
      throw new Error("Vision API error 401");
    });
    const res = await extractor.extract({ filePath: "/tmp/f", caption: "чек на 500" });
    assert.equal(res.needsReview, true);
    assert.equal(res.kind, "unknown");
    assert.equal(res.confidence, 0.1);
    assert.equal(res.rawText, "чек на 500", "caption сохранён как сырой текст");
  });
});

describe("detectKind", () => {
  it("определяет тип по тексту", () => {
    assert.equal(detectKind("чек на сумму 100"), "receipt");
    assert.equal(detectKind("Товарная накладная №5"), "waybill");
    assert.equal(detectKind("Invoice #7"), "invoice");
    assert.equal(detectKind("привет мир"), "unknown");
  });
});
