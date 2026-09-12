# R1 — Выровнены пресеты под продукт (секретарь = архив + ответ по @)

Дата: 2026-09-12 (repo: grihaAi, ветка main)

## Продуктовая матрица (реализовано)

| Preset | Архив text/media/OCR→expense | Ответ agent |
|---|---|---|
| listener | да, всё (без изменений) | только @/reply |
| secretary | **да, всё** (archive_media + archive_ocr_ingest) | @/reply (listen_only остаётся false) |
| team | да, всё (archive_media + archive_ocr_ingest) | @/reply |
| shop | OCR→expense (archive_ocr_ingest) | @ |
| only_me | без изменений (архив опционален) | только мои |
| safe_default | без изменений | @/reply |

## Правки кода
1. `RulePresets.ts`:
   - `secretary` + hard `archive_media=true`, `archive_ocr_ingest=true`
     (listen_only=false, require_mention/reply_to_bot — как были);
   - `team` + hard `archive_media=true`, `archive_ocr_ingest=true`;
   - `shop` + hard `archive_ocr_ingest=true`;
   - `listener`, `only_me`, `safe_default` — без изменений.
2. `bootstrapUsers` (telegram-bot/index.ts) — **R1-repair**: для
   `status=completed|skipped` с presetId в {listener, secretary, team, shop}
   дописываются отсутствующие `archive_media`/`archive_ocr_ingest` через
   `addStructuredRule` (source `repair:<preset>`), **status не сбрасывается**.
3. `group-runtime` pending silent — не тронут (по спеке).

## Тесты
`rule-presets.test.ts` + 4 новых кейса (secretary/team/shop archive-ключи,
listener без регрессий). Прогон rule-presets + chat-policy: 40/40 зелёные.

## Acceptance R1
- Новая secretary-группа: фото без @ → OCR+archive+expense путь ✅
  (policy: archive.photo = listen_only || archive_media → true;
   processing.photoOcr = listen_only || archive_ocr_ingest → true)
- @bot → агент отвечает ✅ (listen_only=false, require_mention=true)
- listener без изменений ✅
- Старые secretary/team/shop-чаты получают archive-ключи на старте (repair) ✅

## Статус: GREEN. Далее R2 (доступ к истории/расходам из DM/группы).
