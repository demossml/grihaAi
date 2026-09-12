# Group ACL by membership — «все в группе, избранные в личке»

Дата: 2026-09-12 (repo: grihaAi, ветка main)
Спека: TZ-group-acl-membership.md

## Реализация

### Новый модуль `apps/agent/.pi/extensions/telegram-bot/telegram-acl.ts`
`resolveTelegramAccess(input, deps)`:
- `hasRealUser=false` (channel_post/sender_chat) → `channel-no-user` (A4);
- **private** → `deps.isAllowedPrivate` (A2): только явный список; `aclMode=open`
  на личку не распространяется; deny → `acl-denied`;
- **group/supergroup** → `getChatMember` статус в
  `{creator, administrator, member, restricted}` (A1); `left/kicked/unknown` →
  `not-in-group` (A3); ошибка getChatMember → `get-chat-member-error` (fail closed);
- без `getChatMember` → `not-in-group`.

### `UsersService.isAllowedPrivate`
DM: заведённый пользователь (`owner|admin|user`), `blocked` → false; посторонний →
false **независимо от глобального open-режима** (глобальный `isAllowed` не тронут —
не-telegram пути работают как раньше, A5).

### `TelegramBridge.checkAgentAcl`
- Приоритет: `options.telegramAccess` → membership-ACL; иначе legacy `aclCheck`; иначе
  whitelist (FR-6 — без telegramAccess поведение прежнее).
- Deny private → «Нет доступа.» (кроме `ACL_DENY_REPLY=0`), группа — молча,
  метрика `telegram_agent_denied`, LLM не вызывается.

### Wiring
- `TelegramBotControllerOptions.telegramAccess` (только `isAllowedPrivate`);
  `getChatMember` контроллер сам привязывает к текущему bot instance
  (валидно при реконнектах).
- `telegram-bot/index.ts` getController: `telegramAccess: { isAllowedPrivate: (id) =>
  users.isAllowedPrivate(id) }`. `ensureOwner(cfg.ownerUserId)` уже вызывается в
  `bootstrapUsers` на старте (подтверждено).

### Tools (§4)
`assertCanReadChat` + `GroupAccessDeps.sourceChatId`: если tool вызван из сессии той
же группы (агент уже прошёл membership-ACL) — чтение истории/расходов **этого**
chatId разрешено без users.json; чужие chatId — только `canManage`/`isAllowed`.
Расходы (`expenses_sum/list`) того же чата и раньше работали (resolveQuery без
кросс-чат-проверки) — участник группы теперь и туда проходит.

### Доки
`docs/TELEGRAM-BOT.md`: секция Membership ACL (A1–A4, fallback, sourceChatId,
ownerUserId).

## Тесты
`apps/agent/tests/unit/telegram-acl.test.ts` (21 тест):
- isAllowedPrivate: open-режим не пускает постороннего; заведённый → true; blocked → false;
- resolveTelegramAccess: private ok/deny; group member без whitelist → ok (isAllowedPrivate
  не вызывается); left/kicked/unknown → deny; throw → deny; нет getChatMember → deny;
  без from → channel-no-user; IN_GROUP_STATUSES;
- bridge: FR-1 member без записи в whitelist → агент отвечает; FR-2 left → молча, без LLM;
  FR-3 stranger DM → «Нет доступа.», без LLM; owner DM → ok;
- assertCanReadChat: sourceChatId=чат → true; чужой чат → false; не configured → false;
  без sourceChatId — прежняя логика.

**Итог: 715 unit-тестов PASS** (было 694), `turbo typecheck` + `build` 12/12.

## Acceptance
- FR-1 ✅ member в группе зовёт бота без записи в users.json (bridge-тест)
- FR-2 ✅ left/kicked denied (unit + bridge)
- FR-3 ✅ stranger DM → «Нет доступа.», без LLM
- FR-5 ✅ getChatMember throw → deny
- FR-6 ✅ нет telegramAccess → legacy aclCheck/whitelist
- Tools: history/expenses для member по текущему chatId ✅ (sourceChatId)
- Не сломано: archive/listener path (A6 — отдельный путь), pending silent, onboarding
  getChatMember, channel without from — покрыто существующими тестами (715 зелёных).

## Manual E2E
1. Пользователь без whitelist пишет @bot в configured-группе → отвечает.
2. Тот же пользователь в DM → «Нет доступа.».
3. Owner DM → ок.

## OUT OF SCOPE (по спеке)
- Archive ACL (по policy, не membership);
- per-group ban UI;
- кэш getChatMember (1 вызов на сообщение допустим).
