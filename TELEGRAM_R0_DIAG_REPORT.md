# R0 — Диагностика режимов групп (audit only)

Дата: 2026-09-12. Код продуктово не менялся (только docs/report).

## Что проверено
1. **Матрица пресетов** — `docs/TELEGRAM-PRESET-MATRIX.md` (secretary/listener/
   team/shop/only_me/safe_default × listen_only/require_mention/archive_media/
   archive_ocr_ingest/only_my_messages).
2. **Пути входящих**: text → `prepareGroupTurn`/`evaluatePreFilter` (archive
   только при listen_only); media → `runMediaPipelineFor` (skipped, если нет
   allowed/archive/kindArchive/kindProcess/mentionIngest).
3. **Tool ACL**: `assertCanReadChat` — configured + (canManage | isAllowed |
   sourceChatId===chatId); из DM без canManage → deny.

## Подтверждённые gaps
- **GAP-1 (подтверждён):** пресет `secretary` в `RulePresets.ts` НЕ содержит
  `archive_media` / `archive_ocr_ingest` (listen_only=false). Поэтому фото/текст
  без @ в secretary-группе не архивируются и не пишутся в expenses. «Секретарь
  архивирует всё» — не баг рантайма, а дыра в пресете. То же у team/shop.
- **GAP-2:** пустые expenses = медиа никогда не доходили до pipeline (skipped)
  +/или чат не configured +/или не тот chatId. Старые чеки в БД не появятся
  сами — нужна пересылка.

## Что НЕ трогали
Pending silent, membership ACL, parseTotal, PDF, dedupe.

## Статус
**GREEN** по критерию R0: матрица есть, gap секретаря подтверждён.
Следующий шаг по серии: R1 (выровнять пресеты + repair).
