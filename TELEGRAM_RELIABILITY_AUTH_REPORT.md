# TELEGRAM_RELIABILITY_AUTH_REPORT.md

## Summary
- Overall: **GREEN**
- typecheck: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок (apps/agent + workspace)
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` — **450/450 passed**
- turbo: `npx turbo run typecheck test build` — все задачи успешны
- Не откачено: silent-until-configured (R1–R8/R10), caption_entities, session keys,
  STT-before-agent, ACL callbacks, forum message_thread_id

## Package A — Send reliability

- `telegram-errors.ts` (новый): `parseTelegramError` (формы: `error_code`+`parameters`,
  nested `response`, description "retry after N", сетевые сообщения), `computeSendDelayMs`
  (retry_after → ровно N секунд, retryable → экспонента base*2^(attempt-1) с jitter,
  иначе 0), `shouldRetrySend` (только retry_after/retryable, не после последней попытки).
- `sendWithRetry` переписан: парсит каждую ошибку, логирует kind/retry_after/паузу;
  403/401/400/unknown — без повторных попыток.
- HTML→plain (D7): plain-фолбэк идёт через тот же `sendWithRetry` (429 на plain не
  теряет сообщение); 400 bad_request на HTML — сразу plain, без ретраев HTML.
- `send-queue.ts` (новый): `ChatSendQueue` — per-chat сериализация исходящих
  sendMessage/sendDocument (бург в один chat_id не улетает параллельно, разные чаты
  не блокируют друг друга). Обёрнут sender бриджа и онбординг-DM.

## Package B — getChatMember authorization

- `chat-auth.ts` (новый): `ChatMemberStatus`, `mapChatMemberStatus`,
  `isGroupAdminStatus`, `assertCanConfigureGroup` (STRICT: только creator/administrator
  этой группы; getChatMember 400/403 → «Нужны права администратора группы.», сеть →
  «Не удалось проверить права, попробуйте позже.» — fail closed).
- `chat-setup/handlers.ts`: мутирующие callback-действия (`p`/`skip`/`custom`/`confirm`/
  `cancel`) для group/supergroup проходят `assertCanConfigureGroup`; `/setup <chatId>`
  проверяет права перед отправкой keyboard. Private `/setup` список — по canManage,
  без getChatMember.
- Wiring: grammy `bot.api.getChatMember` → controller deps → handlers; global owner
  без админства группы пресет применить не может.

## Files changed

- `apps/agent/.pi/extensions/telegram-bot/telegram-errors.ts` (новый)
- `apps/agent/.pi/extensions/telegram-bot/send-queue.ts` (новый)
- `apps/agent/.pi/extensions/telegram-bot/chat-auth.ts` (новый)
- `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts` (sendWithRetry, sendReply, queue, deps getChatMember)
- `apps/agent/.pi/extensions/telegram-bot/index.ts` (getChatMember wiring)
- `apps/agent/.pi/extensions/chat-setup/handlers.ts` (group authority checks)
- tests: `telegram-errors.test.ts`, `chat-auth.test.ts` (новые); обновлены
  `telegram-reconnect.test.ts`, `telegram.test.ts`, `telegram-mention.test.ts`,
  `chat-setup-service.test.ts`, `telegram-setup-command.test.ts`
- docs: `docs/TELEGRAM-BOT.md`, `STATUS.md`

## Test summary

- parseTelegramError: 429+retry_after(13), description "retry after 7", nested response,
  403/400/401, 502 retryable, сетевые ошибки, unknown, лимит попыток
- computeSendDelayMs: retry_after ≥ N секунд, экспонента, 0 для forbidden/unknown
- sendWithRetry: успех после 2 неудач, исчерпание без исключения, 429 с паузой ≥
  retry_after, 403 — ровно 1 попытка на HTML + 1 на plain (без шторма)
- ChatSendQueue: последовательность в одном chatId, параллельность разных chatId,
  ошибка не блокирует следующий таск
- assertCanConfigureGroup: administrator/creator → ok, member → deny,
  throw (сеть) → fail closed, 403 → deny
- handlers: callback member → alert + пресет НЕ применён, creator → применён,
  getChatMember throw → deny; `/setup <chatId>` non-admin → отказ без keyboard
- Регрессии: pending silent, mention (text+caption), session keys, STT, D7, D9, reset —
  все зелёные

## Manual checks

1. 429 в проде сложно форсировать — unit покрывает parse/delay/логи retry_after.
2. Non-admin жмёт старую кнопку пресета → denied («Нужны права администратора группы.»),
   правила не меняются.
3. Admin (creator) применяет пресет → ok, правила применяются.
4. `/setup <chatId>` от admin → keyboard; от non-admin → отказ.
5. Бурст ответов в одну группу → сообщения уходят последовательно (per-chat queue).
