# STATUS

## Current (2026-09-24)

- **Secretary n2** (полный): silent-until-configured (pending = тишина), mention-only в группе,
  group vs DM scope (`resolveGroupQuery` + `assertCanReadChat`), напоминания (tz Moscow,
  `auto_reminders` до add, overdue 24h → `expired`, `sourceMessageId`), реестр ролей
  (`group-participants.sqlite`, owner/admin/member/finance), явная запись расхода
  (`secretary_record_expense` + `payment_purpose`), archive/reactivate без удаления данных.
  См. `docs/SECRETARY.md`.
- **Security P0/P2**: `execute_code` — runsc или refuse (local только dev-флаг); env scrub
  (`buildSandboxEnv` allowlist); injection scan на OCR/STT; `isSafePath` resolve/normalize;
  homoglyph убран; `applyGenerationBudgetToModelConfig` @deprecated. См. `docs/SECURITY.md`.
- **Flash Router + Generation Policy**: rule → flash → fallback; `report_dispatch` floor
  (initial≥1024 / soft≥2048 / hard≥4096); budget через `setModel`. Флаги default OFF.
  См. `docs/FLASH_ROUTER.md`, `docs/GENERATION_POLICY.md`.
- **Observability v2**: turn/routing/budget/finish (correlationId) + reminder.* + secretary.expense.write.
  См. `docs/OBSERVABILITY.md`.

## Known limitations

- `execute_code` без runsc → refuse (нужен gVisor; local — только `GRIHA_EXECUTE_CODE_ALLOW_LOCAL=1` + non-production).
- legacy voice-path (`transcribeVoice` → агент) без injection-scan — follow-up.
- UI-toggle `auto_reminders` (функция `setAutoReminders` есть, команды/кнопки нет).
- `sendNotify` в DM при `needs_confirmation`; `reply_to` на source-сообщение — follow-up.
- `generation.extend` multi-pass в TG runtime — helper готов, prod не вызывает.
- `generation.finish` usage/finishReason — pi не отдаёт (usageAvailable: false).
- Phase 3 auto-calibration — не начат.

## Docs canon (source of truth)

`README.md` + `STATUS.md` + `docs/`: `ARCHITECTURE.md`, `TELEGRAM-BOT.md`, `SECRETARY.md`,
`FLASH_ROUTER.md`, `GENERATION_POLICY.md`, `OBSERVABILITY.md`, `SECURITY.md`,
`SYSTEM_UPDATE.md`, `REPORT_DATA.md`, `PDF_REPORTS.md`, `SKILLS.md`, `EXTERNAL-TOOLS.md`,
`EXTENSIONS.md`.

Исторические фазы — в git log и `docs/archive/`.
