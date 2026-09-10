# VISION_OCR_INGEST_REPORT.md

ТЗ: Подключить vision-распознавание к фоновому OCR-инжесту в группах.

## Summary
- Overall: **GREEN**
- typecheck: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` — **521/521 passed**
- turbo: `npx turbo run typecheck test build` — 16/16

## Что сделано
- `extractors/types.ts`: `VisionExtractor` (принимает `VisionOcrFn(filePath, mime) → string`,
  читает файл в base64 → OCR → парсеры суммы/даты/поставщика → `detectKind`),
  фабрика `createExtractor(config, hasVisionKey, visionOcr?)` — vision только при
  ключе И собранном ocr, иначе честный StubExtractor.
- `extractors/parsers.ts`: `detectKind(text)` — waybill/invoice/receipt/unknown.
- `documents/index.ts`: `buildVisionOcr()` из `createHttpVisionCaller` (тот же backend,
  что `analyze_image` в личном чате) прокинут во все три сервиса:
  `getDocumentIngestService`, `getChatArchiveService`, `getListenerMediaPipeline`.

## Приёмка
1. Unit: `createExtractor(undefined,false)` → Stub; `createExtractor(cfg,true,mockOcr)` → Vision;
   mock «Итог = 125.00» → total=125, kind=receipt, confidence 0.85.
2. Интеграция (вручную): чек в группу → `expense_documents` с суммой, `chat_archive`
   с `ocr_status="done"` и raw_text.
3. Регресс: полный прогон зелёный, typecheck/build чистые.
4. Safety: без `models.vision.apiKey` — stub, без падений.

## Изменённые файлы
- `apps/agent/src/services/documents/extractors/types.ts`
- `apps/agent/src/services/documents/extractors/parsers.ts`
- `apps/agent/src/services/documents/index.ts`
- `apps/agent/tests/unit/vision-extractor.test.ts` (новый, 9 тестов)
- docs: `docs/TELEGRAM-BOT.md`, `STATUS.md` (Phase 33)

## Риски
- Каждое фото в группе = vision-вызов (токены); выключатель — `archive_ocr_ingest`.
- PDF/не-изображения могут не поддерживаться vision — честный `needsReview`/`ocr_status=failed`.
