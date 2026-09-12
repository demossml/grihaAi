# R3 — Регрессионный E2E-набор пресетов

Дата: 2026-09-12 (repo: grihaAi, ветка main)

## Что добавлено
- `tests/unit/telegram-preset-matrix.test.ts` — 25 тестов на реальных фикстурах
  hard-правил каждого пресета (через `prepareGroupTurn` + `evaluatePreFilter` +
  `TelegramBridge`):
  - **A. pending** (все 6 пресетов): агент не вызывается, архив не пишется;
  - **B. text без @**: listener архивирует текст (`archived-silent`), secretary/team
    агента нет;
  - **C. @mention**: safe_default/team/secretary/listener/shop → agent=1;
    only_me — только actor;
  - **D. media policy** (`rulesToChatPolicy`): listener полный архив+OCR;
    secretary/team `archive.photo/document=true` + `photoOcr/documentOcr=true`
    (чеки без @); shop `photoOcr=true` без сырого архива; safe_default — нет;
    bridge-проверка: secretary фото без @ → processMedia вызывается, агент нет;
  - **E. assertCanReadChat**: owner/член своей группы/чужой чат/не configured.
- `docs/TELEGRAM-PRESET-E2E.md` — ручной чеклист 10 пунктов.

## Запреты серии соблюдены
parseTotal/PDF layout/ACL/OCR в R3 не менялись.

## Результаты
- telegram-preset-matrix: **25/25 PASS**.
- Полный набор unit-тестов и typecheck/build прогоняются перед мержем.

## Статус серии
R0 ✅ (матрица+gap) → R1 ✅ (пресеты+repair) → R2 ✅ (доступ) → **R3 ✅**.
R4 — операционный recovery (не код): чеклист в `docs/TELEGRAM-PRESET-E2E.md`.
