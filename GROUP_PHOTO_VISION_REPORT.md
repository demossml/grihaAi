# GROUP_PHOTO_VISION_REPORT

## Summary GREEN

В Telegram-группах (и в личном чате) фото/изображения-документы теперь
**реально распознаются** тем же vision-стеком, что и личный `analyze_image`;
результат попадает в `chat_archive` / `expense_documents` при policy, а в LLM
уходит **текст OCR**, а не голый `file_id` в прозе.

| Баг | Статус | Где |
|---|---|---|
| B1 `createExtractor` → всегда StubExtractor | закрыт ранее (ff2a9be), подтверждён | `extractors/types.ts`, `documents/index.ts` |
| B2 bridge photo/document → текст `file_id:` | закрыт | `TelegramBridge.handleMedia` |
| B3 `maybeIngestDocument` mode=mention блокирует фоновый инжест | смягчён | `processMedia` (force-policy) + `{force, skipAck}` |
| B4 агент «должен сам» вызвать analyze_image | закрыт | OCR выполняется до хода агента |

## B1 VisionExtractor wired?

Да. `createExtractor(config, hasVisionKey, visionOcr?)` возвращает
`VisionExtractor` при ключе И собранном `visionOcr`, иначе — `StubExtractor`.
`buildVisionOcr` (`documents/index.ts`) = `createHttpVisionCaller` +
`cfg.models.vision` — тот же backend, что `analyze_image`. Прокинут во все три
сервиса: `getDocumentIngestService`, `getChatArchiveService`,
`getListenerMediaPipeline`.

## B2 Bridge no longer photo-as-file_id-only?

Да. `handleMedia` (единая ветка photo/document):
- pending-группа → тишина (R-GR-1): ни OCR, ни агента;
- allowed-ход → `processMedia` (download → OCR → archive/expense) **до** агента,
  промпт содержит `Распознанный текст (OCR): …`, `Подпись`, при инжесте —
  `Документ сохранён в expenses id=…`, `telegram_file_id` — справочно внизу;
- OCR fail → агенту «Не удалось распознать изображение.» + подпись, сбой
  download → job в media-retry;
- PDF/non-image → честное «PDF не поддерживается vision-моделью»
  (`buildVisionOcr` бросает для non-image mime, `VisionExtractor` ловит →
  `needsReview`), без притворства JPEG.

## createExtractor behavior with/without key

- ключ + visionOcr → `VisionExtractor` (confidence 0.85 / 0.55 / 0.1;
  `needsReview = total == null || !rawText`; сбой OCR → needsReview-результат,
  исключение не пробрасывается);
- ключа нет (или ocr не собран) → `StubExtractor` (caption-only) — ожидаемая
  деградация, без падений.

## Listener + ordinary group paths

Единая точка — `processMedia` (контроллер решает по structured-правилам чата):

| Контекст | OCR background | Агент |
|---|---|---|
| pending group | нет | нет |
| listen_only, без @ | да (archive + expense при `archive_ocr_ingest`) | нет |
| listen_only, @mention | да | да, с OCR-текстом |
| ordinary configured, allow | да (если медиа) | да, с OCR-текстом |
| ordinary, blocked require_mention | только при `archive_ocr_ingest=true` | нет |

- `maybeIngestDocument({force, skipAck})`: `force` обходит `ingest_mode=mention`
  для listener/`archive_ocr_ingest`; ACL действует всегда; `skipAck` — тихий
  фоновый инжест.
- Expense-инжест по «useful fields» (`total != null || supplier || rawText>20`),
  а не только kind=receipt/invoice — `unknown`+сумма тоже попадает в expenses.
- Typing-heartbeat держится через OCR + ход агента (только когда будет ответ).
- Retry worker (`processMediaRetryJob`) — полный pipeline, тот же extractor.

## Tests: pass/fail counts

`apps/agent`: **536 unit — зелёные** (было 521; +15 новых), fail 0.
`npx turbo run typecheck` — 10/10 задач зелёные.

Новые/обновлённые:
- `tests/unit/group-photo-vision.test.ts` (9): allow→OCR-текст+expenseId,
  document kind, listener без @ (OCR без агента), pending (без OCR), fail→честная
  ошибка, PDF, notify-policy, legacy documentIngest/archiveHandler;
- `tests/unit/maybe-ingest-document.test.ts` (5): force/skipAck/ACL/без файла;
- `tests/unit/vision-extractor.test.ts`: confidence 0.55, сбой OCR → needsReview
  без исключения;
- `tests/unit/listener-media-pipeline.test.ts`: unknown+сумма → expense-строка.

## Manual E2E

1. Configure `models.vision`
2. Listener group: photo without @ → `chat_archive.raw_text` non-empty
   (`ocr_status=done`), при распознанной сумме — строка в `expense_documents`
3. Team/secretary group with mention: photo + @bot → ответ использует OCR-текст
4. Without vision key → degraded stub (caption-only), no crash

## Residual risks (cost, PDF, rate)

- **Cost**: OCR запускается на каждый allowed-ход с медиа в configured-группах и
  на каждый медиа-файл в listener — расходы на vision-API растут линейно числу
  фото. Дедуп по `file_unique_id` не даёт повторных вызовов на тот же файл.
- **PDF**: честный `needsReview`; отдельный PDF-коннектор — future work
  (см. `packages/skills/skills/document-intake-ocr/SKILL.md`).
- **Rate**: vision-провайдер может 429 — экстрактор ловит сбой и помечает
  `needsReview`; retry-очередь покрывает только download-сбои (OCR-ретраи — по
  тому же file_unique_id при следующем process, без залипания).
- **Out of scope**: deterministic workflow state machine, pin/media_group/poll,
  re-OCR исторических `confidence=0.1` строк (опциональный скрипт — отдельно).
