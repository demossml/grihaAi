# Chat Setup — contract (mandatory)

## Group setup contract

- Pending groups are SILENT in-group (R1: prefilter → false, 0 LLM tokens, даже на @mention).
- Setup UI only in DM (R2): пресеты/кнопки — только в личке с addedByUserId.
- safe_default does not complete setup (R4): при add пишется silent, status остаётся pending.
- groupConfigured must be passed into shouldProcessMessage for every group message
  (bridge/controller делают это автоматически через `isConfiguredSync`).
- После completed/skipped действуют обычные hard-rules (mention и т.д.).

## API

- `ChatSetupService.isConfiguredSync(chatId): boolean` — true для completed/skipped,
  false для pending/неизвестно. Hydrate cache: `loadSync()` на старте telegram.
- `ChatSetupService.applyPreset(chatId, presetId, { actorId, silent? })` — пишет правила
  в User Rules через `replaceChatManagedRules`; silent не меняет status.
- Callback data: `cs:{chatId}:{p:{preset}|custom|skip|confirm|cancel}`.

## Не откатывать

- Не отвечать в pending-группе текстом «настройте меня» на каждое сообщение.
- Не переносить кнопки пресетов в группу.
- Не помечать safe_default как completed.
