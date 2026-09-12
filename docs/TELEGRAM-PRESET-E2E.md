# Ручной чеклист пресетов (E2E, 10 пунктов)

Перед проверкой: `/status` — бот работает; `chat-setup.json` — группа completed +
preset; rules.sqlite — после рестарта содержит `archive_media`/`archive_ocr_ingest`
для secretary/team/shop (R1-repair).

1. **Pending-группа**: пишем в неподключённую группу — тишина (нет ответа, нет
   записи в chat_archive).
2. **Listener, текст без @**: сообщение → в `chat_archive` строка появилась,
   ответа нет.
3. **Secretary, текст без @**: ответа нет (require_mention); архивация текста —
   только у listen_only (документировано).
4. **Secretary, @bot**: агент отвечает.
5. **Secretary, фото без @**: в `expense_documents` появилась строка
   (OCR+archive+ingest); ответа нет.
6. **Team, фото без @**: то же (R1: archive_media + archive_ocr_ingest).
7. **Shop, фото без @**: `expense_documents` пополнился (OCR→expense).
8. **Owner из DM**: `group_history` по chatId или `chatTitle` («Ремонт») →
   отдаёт записи настроенной группы; повторный запрос PDF ≤10 мин → без дублей.
9. **Member в группе**: history/expenses по своему chatId работают; чужой chatId → deny.
10. **Незнакомец в DM**: «Нет доступа.», LLM не вызывается (private closed).

## Известные ограничения (по дизайну серии)
- Текст без @ архивируется только в `listen_only`-режиме (listener); secretary/team
  хранят медиа/чеки.
- Старые чеки, не записанные в БД до R1, сами не появятся — переслать файл в группу.
