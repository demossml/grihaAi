# Telegram Preset Matrix (код vs ожидание)

Дата: 2026-09-13 (синхронизировано с `RulePresets.ts` R1). Источник правды для
секции «пресеты»: `RulePresets.ts`, policy: `chat-policy.ts`
(`rulesToChatPolicy`), prefilter: `prefilter.ts`.

## 1. Пресеты (факт из кода)

| Preset | listen_only | require_mention | archive_media | archive_ocr_ingest | only_my_messages | Ответ агента |
|---|---|---|---|---|---|---|
| safe_default | false | true | — | — | false | @/reply |
| team | false | true | **true** | **true** | false | @/reply |
| secretary | false | true | **true** | **true** | false | @/reply |
| listener | true | true | true | true | false | только @/reply |
| shop | false | true | — | **true** | false | @ |
| only_me | false | false | — | — | true (+user_id) | только мои |

Примечание: `shop` архивирует чеки (OCR+expenses) без `archive_media`
(медиа-архив полного файла не ведётся).

## 2. Как policy собирается из правил (chat-policy.ts)

```
archive.text        = listen_only
archive.photo       = listen_only || archive_media
archive.document    = listen_only || archive_media
archive.voice       = listen_only || archive_media
processing.photoOcr = listen_only || archive_ocr_ingest
processing.documentOcr = listen_only || archive_ocr_ingest
```

Вывод: **архив/OCR без @ есть у listener** (listen_only=true), **secretary/team**
(явные `archive_media`+`archive_ocr_ingest`) и **OCR-инжест у shop**
(`archive_ocr_ingest`).

## 3. Пути входящих сообщений

### Text (private/group)
`prepareGroupTurn` (group-runtime) → `evaluatePreFilter(hard)`:
- pending (не configured) → `group-not-configured`, архив НЕ пишется (даже при @);
- listen_only + без @ → `process=false, archive=true, suppressReply=true` →
  bridge: `archiveQuietly` (тихо в chat_archive), агент НЕ вызывается;
- require_mention + без @ (не listener) → `process=false, archive=false` →
  **текст НЕ архивируется**;
- @ / reply → агент (по ACL membership/private).

### Media (photo/document)
`runMediaPipelineFor` (telegram-bot/index.ts):
- `kindArchive = policy.archive.{photo|document}`;
- `doOcrIngest = kindProcess || mentionIngest` (`ingest_mode` + caption-hint);
- если `!allowed && !archive && !kindArchive && !kindProcess && !mentionIngest`
  → `{skipped: true}` — **медиа без @ и без archive-ключей вообще не
  скачивается, не OCR'ится, не пишется в expenses**.

## 4. Tool ACL (group_history / expenses)

`assertCanReadChat` (groupHistoryTools.ts):
- configured + `canManage(userId)` → любой configured чат;
- configured + `isAllowed(userId, chatId)` → allow;
- configured + `sourceChatId === chatId` → allow (member в своей группе);
- иначе deny «Чат не настроен или нет доступа.».

Из **DM** `sourceChatId` = личный чат ≠ группа → без canManage/isAllowed будет
deny. Owner в users.json (`role=owner`) проходит по canManage.

## 5. Ожидание vs код (R0-выводы)

| Ожидание | Код | Gap |
|---|---|---|
| «секретарь архивирует всё и отвечает по @» | secretary: archive_media + archive_ocr_ingest (R1) | **ЗАКРЫТО** кодом |
| «в группе фото без @ → чек в expenses» | listener/secretary/team/shop (OCR) | **ЗАКРЫТО** кодом |
| owner из DM читает configured-группу | canManage → ok (если owner в users.json) | ок |
| member читает свою группу | sourceChatId → ok | ок |
| пустая expenses у группы | медиа не доходили до pipeline (старый пресет без archive-ключей до R1) или группа не configured / не тот chatId | **GAP-2** (данные) |

## 6. Вероятные причины «пустой expenses» у конкретной группы
1. Пресеет применялся ДО R1 (archive-ключи добавлены позже): repair на старте
   перезаписывает managed-правила у completed-чатов (bootstrapUsers, A3).
2. `chat-setup.json`: статус не completed/skipped → pending silent.
3. Не тот preset (safe_default) — нет архива по дизайну.
4. Tool ACL из DM без canManage → «нет доступа» (не пустая БД, а deny).
5. Старые чеки не пересланы: архив Telegram ≠ backfill из облака TG.
