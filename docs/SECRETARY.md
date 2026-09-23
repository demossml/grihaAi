# Secretary — S1+S2 (silent listener + group reminders)

Режим «Секретарь» в группах: молчит по правилам, слушает и архивирует, умеет
ставить напоминания по таймеру. Роли пользователей (**S4**) и явные поручения
«запиши расход» (**S3**) — в этом PR **НЕ** сделаны.

## Контракт поведения (S1)

- **R-S1-1** — группа не настроена (`pending`) → полная тишина, агент не вызывается
  даже на @mention (`evaluatePreFilter` → `group-not-configured`).
- **R-S1-2** — secretary / listen_only → ответ только на `@mention` / reply боту;
  обычные сообщения — тихий архив (`process=false`, `suppressReply=true`, `archive=true`).
- **R-S1-3** — никаких проактивных «я заметил ошибку» без mention (агент не вызывается).
- **R-S1-4** — DM (private) — control plane: group-правила (`require_mention` /
  `listen_only`) к личке не применяются; настройка и управление — только в DM + `canManage`.

Закреплено тестами `apps/agent/tests/unit/secretary-contract.test.ts` (R-S1-1…R-S1-4)
поверх существующего Layer-1 prefilter (`user-rules/prefilter.ts`).

## Group vs DM

| Контекст | Поведение |
|---|---|
| Группа pending | тишина (R-S1-1) |
| Группа secretary/listen_only без mention | тихий архив, ответ подавлен |
| Группа + mention/reply | агент отвечает |
| DM | управление (`/groups`, `/setup`), ACL `canManage` |

## Напоминания (S2)

- **Модель данных** — `GroupReminderService` (`apps/agent/src/services/reminders/`),
  отдельная SQLite `~/.grish-ai/group-reminders.sqlite` (не трогает commitments/memory/
  documents). Поля: `chatId`, `threadId`, `sourceMessageId`, `dueAt`, `text`, `status`,
  `confidence`.
- **Статусы** — `pending` / `needs_confirmation` / `fired` / `cancelled`.
  `confidence < 0.5` → `needs_confirmation` (не попадает в `listDue`, не спамим в группу).
- **Флаг `auto_reminders`** — structured rule `auto_reminders` (scope=chat), **default ON**
  (не задан → включён). `setAutoReminders(chatId, enabled)` + `isAutoRemindersEnabled(chatId)`
  (`apps/agent/.pi/extensions/user-rules/auto-reminders.ts`). Toggle — функция есть;
  отдельной UI-команды пока нет (вручную через rule).
- **Wire `fireDue`** — tick 30с в bot bootstrap (`startReminderTick` → `fireDue` →
  `sendNotify` в ту же группу, `message_thread_id` если `threadId`). Пропускает:
  неактивные чаты (archived/pending) и чаты с `auto_reminders=false`.
- **Детект из входящего** — `detectExplicitReminder` (`reminders/detect-reminder.ts`,
  без LLM/NLP): маркер («напомни», «созвон», «встречу»…) + явное время («14:00»).
  Только scenario `secretary`, тихий create (в группу НЕ пишем «я поставил напоминание»).
  Без явного времени / относительные сроки («через 5 минут») → `null` (не угадываем).

## Observability

- `reminder.create` { status, confidence }
- `reminder.fire` { ok }
- `reminder.skip` { reason: `chat_inactive` | `auto_reminders_off` }

## What is NOT in this version

- **S4 роли пользователей** — later.
- **S3 явные поручения** («Гриша, запиши расход…») — later.
- **Полный NLP** всех сообщений через Pro — не делаем.
- `sendNotify` в DM при `needs_confirmation` (follow-up).
- `reply_to` на source-сообщение в напоминании (follow-up).
- UI-toggle `auto_reminders` (есть функция, нет кнопки/команды).

## Как проверить вручную (Telegram)

1. Добавь бота в группу, заверши onboarding, выбери сценарий «Секретарь — тихий архив».
2. Без @mention группа молчит, сообщения архивируются.
3. Напиши в группу «Гриша, напомни завтра созвон в 14:00» → тихо создастся reminder.
4. Дождись 14:00 → бот пришлёт «Напоминание: …» в ту же группу (если `auto_reminders` on).
5. Проверь журнал: `npm run obs -- query --event reminder.create --limit 10`.
