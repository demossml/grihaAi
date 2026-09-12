# R2 — Доступ к истории/расходам «как раньше» (DM + группа)

Дата: 2026-09-12 (repo: grihaAi, ветка main)

## Что сделано
1. **sourceChatId всегда передаётся** — group-memory tools передают `sourceChatId`
   из session context (подтверждено); expenses_sum/list для того же чата и так
   работают без кросс-чат-проверки.
2. **assertCanReadChat** (проверено, уже корректен после membership-ACL):
   - configured + `canManage(owner)` → любой configured чат (в т.ч. из DM);
   - configured + `isAllowed` → allow;
   - configured + `sourceChatId === chatId` → allow (member в своей группе);
   - иначе deny «Чат не настроен или нет доступа.».
   Private `isAllowedPrivate` не ослаблялся.
3. **chatTitle-резолюция** для owner (R2.3):
   - `group_history({ chatTitle: "Ремонт" })` — ищет среди configured чатов по
     названию (setup cache, case-insensitive contains);
   - только owner/admin (`canManage`) — для посторонних отказ с подсказкой
     «Поиск чата по названию доступен только owner/admin»;
   - 0 совпадений → «Чат … не найден среди настроенных»;
   - >1 совпадений → «Найдено несколько чатов: … Уточните chatId».
4. `GroupAccessDeps.listConfiguredChats` (chatId + chatTitle) — из
   `ChatSetupService.list()` (completed|skipped).

## Тесты
`group-history-tools.test.ts` + 5 кейсов R2:
- owner из DM (sourceChatId ≠ группа) читает configured-группу;
- member без users.json из DM → deny;
- chatTitle owner → резолв в нужный чат;
- chatTitle не owner → отказ с подсказкой;
- несколько совпадений → уточнить chatId.
19/19 зелёные.

## Acceptance R2
- Owner DM читает configured-группу ✅
- Member — только свою группу (sourceChatId) ✅
- unconfigured → deny ✅
- Private isAllowedPrivate не ослаблен ✅

## Статус: GREEN. Далее R3 (регрессионный E2E-набор пресетов).
