# FIX: duplicate expense PDF send (report tool + send_file + «Готово!»)

Дата: 2026-09-12 (repo: grihaAi, ветка main)
Спека: TZ-fix-duplicate-report-send.md

## Root cause
Один agent turn:
1. `expenses_report_pdf` → `setSessionFile` → автоотправка в конце хода;
2. LLM дополнительно зовёт `send_file` на **тот же путь** → второй PDF;
3. финальный текст «Готово!…» → третье сообщение.
Дедуп отчёта не покрывал `send_file`; текстовое правило «только PDF» без structured
`report_attachment_only` не включало attachmentOnly.

## Правки

### D1/D2 — дедуп в коде
`apps/agent/src/utils/telegram/session-files.ts`:
- `canonicalFilePath` (realpath с fallback), `peekSessionFileRecord`,
  `hasPendingSessionFile` (тот же путь уже ждёт автоотправки);
- `wasRecentlySentFile` / `markRecentlySentFile` — per-session Map TTL **10 мин**.

`apps/agent/.pi/extensions/telegram-file-send/index.ts`:
- `checkSendFileDuplicates(sessionId, absPath)` — pending → «Файл уже поставлен в
  очередь отправки.», recently-sent → «Файл уже отправлен недавно.» (с логом
  `[send_file] suppress: …`);
- после успешной отправки — `markRecentlySentFile`. Разные пути НЕ подавляются
  (D5); photo/storageKey не тронуты.

### D3 — structured report_attachment_only
- `MANAGED_RULE_KEYS` дополнен `report_attachment_only`.
- `UserRulesService.addStructuredRule` — идемпотентный upsert structured-правила
  (rule_key/value) для чата.
- `bootstrapUsers` (telegram-bot/index.ts): repair для completed/skipped чатов —
  если есть текстовое правило «только … PDF»/«отчёт … только … pdf»/«без текста»
  и нет structured-ключа → `report_attachment_only=true` (source
  `repair:report-only`).
- attachmentOnly-поведение bridge/pool уже было: файл уходит один, финальный
  текст (включая «Готово!») отбрасывается (проверено тестом).

### D7 — skills
`expenses/SKILL.md` + `core/SKILL.md`: после успешного `expenses_report_pdf`
файл уже в очереди — НЕ вызывать `send_file` на тот же путь; при
`report_attachment_only` не писать «Готово»/сопроводительный текст.

## Тесты (`tests/unit/duplicate-report-send.test.ts`, 7 шт.)
1. Отчёт в очереди → `hasPendingSessionFile` true для того же path, false для
   другого; `peek` отдаёт dedupeKey; `take` очищает.
2. Канонический путь: symlink == realpath.
3. Recently sent TTL: mark → true; другой путь → false.
4. `checkSendFileDuplicates`: pending → suppress; recently sent → suppress;
   другой путь → undefined (не подавляется).
5. Bridge attachmentOnly: один outbound, текст «» (без «Готово!»), без подписи.

**Итог: 736 unit-тестов PASS** (было 729), `turbo typecheck` + `build` 12/12.

## Acceptance
- Один запрос отчёта → один PDF (report pending подавляет send_file) ✅
- Нет второго идентичного PDF (TTL 10 мин) ✅
- Нет «Готово!» при report_attachment_only (attachmentOnly → text="") ✅
- Лог на подавление (`[send_file] suppress: …`) ✅
- Private без правила: текст+файл как раньше; дубль того же path гасится ✅
- photo/storageKey другие файлы не сломаны (D5) ✅

## OUT OF SCOPE
PDF-вёрстка/категории, parseTotal/OCR, ACL.
