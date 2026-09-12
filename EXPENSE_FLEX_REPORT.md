# Expense flexibility: categories, corrections, dimensions, reports (no hardcode)

Дата: 2026-09-12 (repo: grihaAi, ветка main)
Спека: TZ (F1–F9). Все правки additive; парсер R1.x, listener OCR, group ACL не тронуты.

## 1. Модель данных (F1/F3/F6)
`expense_documents` дополнен nullable-колонками (миграция ALTER — старые БД открываются):
- `category TEXT` — свободная строка (никаких enum доменов);
- `tags TEXT`, `line_items TEXT`, `attrs TEXT` — JSON.
Новая таблица `expense_learning(chat_id, pattern_type, pattern, category, updated_at)` —
chat-scoped память исправлений (UNIQUE на тройку).

`ExpenseDocument` дополнен: `category`, `tags`, `lineItems: ExpenseLineItem[]`,
`attrs`. Запрещённые enum-категории не вводились.

## 2. Классификация при ingest (F2/F3)
`classify-expense.ts`:
- `classifyExpense(input, {llm})` — лёгкий LLM JSON-call (system-prompt: свободная
  категория, позиции `{name, qty, unit, amount}`, не выдумывать суммы, unsure → null);
- `memoryHintMatch` — ДЕТЕРМИНИРОВАННО: если поставщик/ключевое слово уже в
  `expense_learning` чата, категория берётся из памяти без LLM;
- сбой классификации → `{}` (category=null), ingest не блокируется.
`ListenerMediaPipeline`: deps `classifyExpense`, вызывается после OCR; результат
пишется в `expense_documents` (category/tags/line_items).
`documents/index.ts`: дефолтный классификатор — память чата → `createHttpLearningLlm`
(main-модель) → честный null.

## 3. Исправление пользователем (F4)
Новый tool `expense_update` (documents extension):
- `expenseId` (или последний расход чата) + `category`/`addTags`/`note`;
- UPDATE row + upsert `expense_learning`: supplier → category; keyword из note
  («по слову X») → keyword-правило;
- ответ: «Перенёс в „…“. Запомнил для похожих чеков в этой группе.»
Skill expenses: фразы «перенеси в…» → вызывать `expense_update`.

## 4. Отчёты без хардкода разрезов (F5/F7)
`expenses_report_pdf` расширен: `dimension` (none|supplier|category|tag,
свободная строка; неизвестный → ошибка с подсказкой), `filterValue`.
`groupReportRows` агрегирует секции с под-итогами в коде (суммы из БД).
`russian-pdf.ts` — обязательная вёрстка «как раньше»:
- заголовок 20pt #1F3864: «Отчёт по расходам — группа «{chatTitle}»» (не chatId);
- подзаголовок периода/разреза 12pt #555555;
- секции разреза с названием жирным #1F3864 и под-итогами;
- таблица: шапка #1F3864/белый, чередование строк #EEF2F8, колонки
  Дата | Поставщик | (Категория при category) | Сумма;
- блок ИТОГО зелёный #2E9E5B, белый жирный.
`chatTitle` берётся из `ChatSetupService` (заголовок чата), fallback «Чат {id}».
Кириллица — встроенный DejaVu/AGENT_RUSSIAN_FONT_PATH (как в прошлом фиксе).

## 5. Гибкие вопросы «сколько метров кабеля» (F6)
Новый tool `expenses_search`: LIKE-поиск по raw_text/supplier/category/line_items,
агрегация qty по unit («100 м»), фрагменты чеков; если позиции не структурированы —
честный ответ «не разобрано по позициям» + фрагменты. `sumLineItemQty` — для UI/тестов.

## 6. Дедуп запросов отчёта (§6)
`expenseReportTools`: in-memory `wasReportRecentlySent/markReportSent` (TTL 10 мин)
по dedupeKey (`expense-pdf:{userId}:{chatId}:{dimension}:{filter}:{dates}:{total}:{count}`);
повторный запрос → «Отчёт только что отправлял.» без второго файла.
Плюс прежний дедуп пула (attachmentOnly/dedupeKey) не тронут.

## 7. Skills
`expenses/SKILL.md`: Categories & corrections, Report dimensions, Flexible questions.

## Тесты (`tests/unit/expense-flex.test.ts`, 14 шт.)
1. Миграция: старая схема открывается, flex-колонки добавляются.
2. Ingest сохраняет категорию/позиции из mock-классификатора.
3. `expense_update` меняет категорию + пишет learning-правило для чата.
4. Память: следующий чек того же поставщика → категория из `memoryHintMatch`;
   keyword из note.
5. `groupReportRows`: category → секции с под-итогами; supplier/filter; неизвестный
   разрез → ошибка; сумма секций = сумме строк.
6. Дедуп отчёта: повторный ключ подавлен, другой — проходит.
7. `expenses_search`: поиск + «100 м»; без позиций — честный ответ с фрагментами.
8. `classifyExpense`: LLM JSON → категория/позиции; сбой → `{}` без падения.
Обновлены тесты рендера PDF под `chatTitle` + секции (expense-report-fixes.test.ts).

**Итог: 729 unit-тестов PASS** (было 715), `turbo typecheck` + `build` 12/12.

## Acceptance
- Новая группа без кода: категории — свободный текст из модели ✅
- «перенеси в X» → БД + память этой группы ✅
- «по категориям/поставщикам» → PDF с секциями+под-итогами, кириллица, название
  группы ✅ (вёрстка §4.3 возвращена)
- «сколько кабеля/болтов» → данные или честное «не структурировано» ✅
- Повторный запрос отчёта ≤10 мин → без дублей ✅
- Итоги из parseTotal/БД (R1.x не тронут; 729 тестов зелёные) ✅

## OUT OF SCOPE (по спеке)
Идеальный OCR позиций, общая онтология категорий между группами, замена vision-модели.
