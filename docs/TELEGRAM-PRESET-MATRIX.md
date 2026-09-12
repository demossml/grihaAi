# Telegram Preset Matrix (код vs ожидание)

Дата: 2026-09-12. Источник правды для секции «пресеты»: `RulePresets.ts`,
policy: `chat-policy.ts` (`rulesToChatPolicy`), prefilter: `prefilter.ts`.

## 1. Пресеты (факт из кода)

| Preset | listen_only | require_mention | archive_media | archive_ocr_ingest | only_my_messages | Ответ агента |
|---|---|---|---|---|---|---|
| safe_default | false | true | — | — | false | @/reply |
| team | false | true | — | — | false | @/reply |
| **secretary** | false | true | **— (нет!)** | **— (нет!)** | false | @/reply |
| listener | true | true | true | true | false | только @/reply |
| shop | false | true | — | — | false | @ |
| only_me | false | false | — | — | true (+user_id) | только мои |

## 2. Как policy собирается из правил (chat-policy.ts)

```
archive.text        = listen_only
archive.photo       = listen_only || archive_media
archive.document    = listen_only || archive_media
archive.voice       = listen_only || archive_media
processing.photoOcr = listen_only || archive_ocr_ingest
processing.documentOcr = listen_only || archive_ocr_ingest
```

Вывод: **архив/OCR без @ есть ТОЛЬКО у listener** (listen_only=true) либо при
явных `archive_media`/`archive_ocr_ingest`.

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
| «секретарь архивирует всё и отвечает по @» | secretary: нет archive_media/archive_ocr_ingest | **GAP-1** (дыра в пресете) |
| «в группе фото без @ → чек в expenses» | только при listen_only или archive_* ключах | **GAP-1** следствие |
| owner из DM читает configured-группу | canManage → ok (если owner в users.json) | ок |
| member читает свою группу | sourceChatId → ok | ок |
| пустая expenses у группы | медиа не доходили до pipeline (GAP-1) или группа не configured / не тот chatId | **GAP-2** (данные) |

## 6. Вероятные причины «пустой expenses» у конкретной группы
1. Группа сидит на `secretary`/`team`/`shop` без archive-ключей → медиа без @
   пропускались (skipped) и никогда не писались в `expense_documents`.
2. `chat-setup.json`: статус не completed/skipped → pending silent.
3. Не тот preset (safe_default) — нет архива по дизайну.
4. Tool ACL из DM без canManage → «нет доступа» (не пустая БД, а deny).
5. Старые чеки не пересланы: архив Telegram ≠ backfill из облака TG.
