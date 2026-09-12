# CONCISE_REPLIES_TIMEOUT_REPORT

**Spec**: «Concise replies + no infinite «typing» hang» (C1–C8) — краткие ответы в Telegram, жёсткий wall-clock таймаут хода агента, отсутствие вечного «печатает…».

**Статус**: DONE. Unit: **795/795 green**. Turbo `typecheck`+`build`: **12/12 successful**.

## Что сделано

### C1/C6 — краткость
- `packages/skills/skills/core/SKILL.md` — новая секция **«Response style (Telegram)»**:
  1–3 коротких предложения/плотный список; без филлеров («Конечно», «Давайте разберём»);
  без простыней, если явно не просят «подробно/развернуто»; после инструментов — одна короткая
  строка; цифры/факты из инструментов; не уверен → один уточняющий вопрос.
- `TelegramSessionPool.runPrompt` — **`[STYLE] length: short / verbosity: low [/STYLE]`**
  подмешивается в **каждый** turn-промпт (group + private; в group — после `rulesContext`).
- Исходящий текст агента обрезается `clipTelegramText` (`GRIHA_TG_MAX_REPLY_CHARS`, default 4000);
  маркер обрезки — `…(сокращено)`. Caption/пути файлов не режутся.

### C3/C4 — таймаут и «typing» hang
- Новый модуль `apps/agent/.pi/extensions/telegram-bot/agent-turn-timeout.ts`:
  - `withTurnTimeout(ms, work(signal))` — AbortController + `Promise.race`, очистка в `finally`;
  - `TurnTimeoutError`, константы `TURN_TIMEOUT_MESSAGE` / `TURN_ERROR_MESSAGE` / `EMPTY_REPLY_MESSAGE`;
  - `TURN_MS = GRIHA_AGENT_TURN_MS ?? 90_000`, `TURN_HEAVY_MS = GRIHA_AGENT_TURN_HEAVY_MS ?? 180_000`.
- `TelegramBridge.runAgent(input, heavy)` — все **6** мест вызова агента (voice, contact, location,
  text, album, media) обёрнуты в `withTurnTimeout`; тяжёлые ветки (voice/album/media) — 180s,
  лёгкие — 90s. Timeout → одно короткое «Слишком долго обрабатываю запрос…», ошибка →
  «Не удалось обработать запрос.». Typing heartbeat и так останавливается в `finally` на всех
  call-sites → вечный «печатает…» исключён.
- Опции моста: `agentTurnTimeoutMs`, `agentTurnHeavyTimeoutMs` (для тестов и тонкой настройки).
- **PDF не отменяется**: таймаут только возвращает текст; уже сгенерированный файл в тяжёлой ветке
  (180s) не выбрасывается.

### §4 — пустой ответ
- `runAgent`: пустой текст **и** нет файла/attachmentOnly → `EMPTY_REPLY_MESSAGE`
  («Пустой ответ. Переформулируйте вопрос.»). `attachmentOnly` + файл НЕ трогается.
- Listener-silent и `suppressReply`-пути не задеваются (fallback не уходит).

### Документация
- `docs/TELEGRAM-BOT.md`: абзац про turn-timeout/env-переменные в разделе про `TelegramBridge`
  и абзац про STYLE-префикс/clip в разделе 5 (SessionPool).

## Тесты
- Новый `apps/agent/tests/unit/concise-timeout.test.ts` (9 кейсов): резолв/зависание
  `withTurnTimeout`, передача `AbortSignal`, clip с маркером, bridge-timeout → ровно одно
  `TURN_TIMEOUT_MESSAGE`, пустой ответ → `EMPTY_REPLY_MESSAGE`, `attachmentOnly`+файл без подмены,
  наличие «Response style (Telegram)» в core `SKILL.md`.
- Обновлены ассерты пула под STYLE-префикс: `telegram.test.ts` (isolated/reuse/D2/file-path),
  `telegram-reset.test.ts` (prompts включают сообщение).

## Проверки
```
apps/agent: npx tsx --test "tests/unit/**/*.test.ts"  → 795 pass / 0 fail
npx turbo run typecheck build                        → 12/12 successful
```

## Env-переменные
| Переменная | Default | Смысл |
|---|---|---|
| `GRIHA_AGENT_TURN_MS` | 90000 | таймаут лёгкого хода |
| `GRIHA_AGENT_TURN_HEAVY_MS` | 180000 | таймаут тяжёлого хода (media/album/OCR) |
| `GRIHA_TG_MAX_REPLY_CHARS` | 4000 | лимит исходящего текста |

## Критерии приёмки
- зависший агент → ≤ таймаута короткое сообщение, «печатает…» гаснет (heartbeat в finally) ✅
- краткие ответы по умолчанию; «подробно» → длиннее разрешено (skill: разрешено по запросу) ✅
- PDF не отменяется таймаутом (тяжёлая ветка 180s) ✅
- listener-silent — без ложных timeout-сообщений ✅
- тесты зелёные ✅

**Out of scope** (по спекам): смена модели/temperature, стриминг, переписывание group runtime/ACL.
