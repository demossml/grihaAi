# Secretary mode (n2 contract)

Тихий архивариус + mention + напоминания в группу + DM-управление. Секретарь
использует уже готовое ядро (Flash Router / Generation Policy / Obs v2) — не копирует.

## Why

В группе секретарь видит только эту группу; в личке — несколько групп по названиям
+ ACL. После add — тишина, пока в личке не выбран сценарий «Секретарь». Три режима
в группе: молчит | напоминание в группу | отвечает только на @/reply. Не лезет с
«я заметил ошибку», если не спросили.

## Onboarding R1

- `my_chat_member` add → chat `pending`, группа **SILENT** (агент не вызывается).
- Owner получает DM-онбординг; выбор сценария `secretary` (`scenarios/registry.ts`,
  `defaultPresetId: "listener"`).
- До `active` — никаких ответов в группе (R-GR-1: pending = полная тишина).

## Behavior R2

- Default `listen_only` + `require_mention`: без @bot/reply_to_bot агент не отвечает.
- Архив текста/медиа идёт всегда, когда policy archive on (существующий pipeline).
- Никакой проактивной критики без mention.

Закреплено: `apps/agent/tests/unit/secretary-contract.test.ts` (R-S1-1…R-S1-4).

## Scope group vs DM R3

- Сообщение в группе G → tools/context `chatId = G` только.
- В личке — резолв нескольких групп по названию (`resolveGroupQuery`,
  `resolveReportDataScope`); `assertCanReadChat` на каждую; неоднозначность → спросить,
  chatIds не выдумывать.

## Documents R4

- Photo/PDF → download → OCR → archive; low confidence → `needs_review`.
- OCR не считается ground truth для денег без expense-ingest правил.

## Explicit write + payment purposes R5

- По mention + «запиши/занеси расход|платёж» → structured запись через tool
  `secretary_record_expense` (в группе `chatId` из сессии; в личке — args.chatId + ACL).
- `needs_review=false` (явное поручение), `source="secretary"`, колонка `payment_purpose`.
- Словарь: `materials, equipment, services, rent, utilities, taxes, collection, salary,
  household, transport, repair, advertising, refund, accountable, other` + free-text note.
- Casual chat без явного «запиши» → строк расхода НЕ создаём.

## Reminders R6 (tz Moscow, auto_reminders, overdue 24h, sourceMessageId)

- Детект явного времени+обязательства regex-сначала (`detect-reminder.ts`, без Pro).
  - «через N минут/часов» → confidence 0.4 → `needs_confirmation`.
  - «в 14:00» → 0.9; «завтра» (date only) → 0.7, default 09:00.
- Timezone: Europe/Moscow (UTC+3, фикс., без DST для v1); `dueAt` — UTC-Instant;
  override через `GRIHA_TZ` (пока фиксированный offset).
- `auto_reminders=false` → НЕ add И НЕ fire (проверка **до** add, не только в `fireDue`).
- `fireDue` шлёт в ту же группу (+ `threadId`), НЕ в личку участникам.
- Overdue старше 24ч → `expired` (не спамим при re-enable); `sourceMessageId` хранится.

## Roles R7

- Реестр участников (`~/.grish-ai/group-participants.sqlite`): upsert на каждом
  групповом сообщении (userId, displayName, chatId, lastSeenAt).
- Роли Griha: `owner | admin | member | finance` (не Telegram-admin API).
- `addedByUserId` при setup → `owner` (если ещё нет). Назначение ролей — только
  `canManage` (UsersService) в DM; `member` не может.
- `finance` OR `canManage` → expense reports; `member` → ограниченно.

## Reports R8

- `kind report_dispatch` (из router) — агент обязан звать tools; суммы не выдумывать.
- В группе scope enforced по chatId; в личке multi-group только + ACL.

## Lifecycle R9

- `markArchived` — перестать слушать, данные SQLite НЕ стираем.
- `reactivate` — тот же chatId, данные целы.

## Relation to Flash Router / Generation Policy R10

- Inbound secretary всё равно проходит Layer-1 gate (`prefilter`).
- Router (`routing.decision`) + generation budget применяются только когда reply path
  разрешён (mention/reply). Тихий детект reminders не вызывает Flash и не пишет в группу.
- Ядро router/budget/obs НЕ форкается для secretary.

## Manual E2E checklist

1. Add бота в группу → pending, тишина.
2. DM: `/groups` → выбрать сценарий «Секретарь — тихий архив».
3. В группе без @ — тишина + архив; с @ — ответ.
4. «Гриша, запиши расход 1500 материалы (болты)» → строка в `expense_documents`
   (`payment_purpose=materials`, `needs_review=false`).
5. «Гриша, напомни завтра созвон в 14:00» → тихий `group_reminders` (pending, tz Moscow).
6. В 14:00 Москвы → «Напоминание: …» в ту же группу.
7. `npm run obs -- query --event reminder.fire --limit 10`.

## Out of scope

- Полный NLP всех сообщений через Pro.
- UI-toggle `auto_reminders` (функция `setAutoReminders` есть, команды/кнопки нет).
- `sendNotify` в DM при `needs_confirmation` (follow-up).
- `reply_to` на source-сообщение в напоминании (follow-up).
