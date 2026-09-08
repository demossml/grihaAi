# Griha AI — Skills Implementation Plan

План разбит на 6 фаз, соответствующих этапам 2–7. Каждая фаза заканчивается
`npm run typecheck` + `npm test` (+ `npm run build` при изменении пакетов).

Принципы (из MASTER):
- не строить параллельную систему — встраивать в существующие extensions/services;
- SKILL.md = инструкции модели; бизнес-логика — TypeScript (service/tool/extension);
- не имитировать внешние интеграции (Gmail/Calendar/Travel/Accounting) — connector-ready boundary;
- необратимые действия — только через approval policy.

## Фаза 1 — Foundation & Safety (этап 2)

1. **human-approval-gate** — новый extension `approval-gate`:
   - модель `ApprovalRequest`/`ApprovalPolicy` + классификация `READ_ONLY | REVERSIBLE_LOW_RISK | SIDE_EFFECT | HIGH_RISK / IRREVERSIBLE`;
   - сервис `ApprovalService` (persistence `~/.grish-ai/approvals.sqlite`);
   - инструменты `approval_required`, `approval_status`, `approval_grant`;
   - привязка approval к action+arguments+target+userId+session+tll; одно approval ≠ другое approval.
2. **approval-thresholds** — `FinancialApprovalPolicy` (`currency`, `autoApproveBelow`, `alwaysConfirmAbove`, `categoriesAlwaysConfirm`) + инструменты `policy_get/policy_set`; политика имеет приоритет над LLM.
3. **commitment-tracking** — модель `Commitment` + `CommitmentService` + инструменты `commitment_add/list/update/complete/cancel`; извлечение из сообщений (who/what/deadline/confidence); статусы `open|due_soon|overdue|completed|cancelled`; низкая confidence → уточнение.
4. **voice-intake** — agent-tool `transcribe_voice` (обёртка над `@griha/stt`), confidence + уточнение при неоднозначности; не додумывать числа/даты/имена/суммы.
5. **privacy-data-hygiene** — фильтр секретов в `memory_add` (API keys/passwords/tokens/платёжные реквизиты) + provenance для важных фактов.
6. **delegation-triage** — уточнение `adaptive-router` (не делегировать короткие reminders/CRUD/классификации).
7. Skills в `packages/skills`: `human-approval-gate`, `approval-thresholds`, `commitment-tracking`, `voice-intake`, `privacy-data-hygiene`, `delegation-triage`.
8. Тесты: approval boundaries, threshold logic, commitment extraction/status, low-confidence voice, secret filtering, delegation classification.

## Фаза 2 — Proactive assistant (этап 3)

1. **daily-briefing** — `BriefingItem` + `BriefingService` + cron job (timezone из профиля); агрегация сегодня/встречи/overdue/следование/клиенты/anomalies/pending approvals; подавление дублей; компактный формат.
2. **anomaly-watch** — модель `Anomaly` + детектор (baseline + threshold + confidence + explanation); резкий рост расходов, duplicate invoice, overdue invoice/commitment, необычная категория, повторяющийся failed workflow, конфликт данных.
3. **meeting-prep** — агрегация контакта/прошлых встреч/open commitments/client notes перед встречей (cron заранее).
4. **meeting-followup** — из meeting notes: summary → decisions → action items → commitments → draft follow-up (отправка через approval).
5. **contact-context-briefing** — client notes + commitments + последние взаимодействия + открытые вопросы.
6. **calendar-scheduling** — `Event`-модель + connector-ready слой (без реального календаря).
7. **focus-time-protection** — meeting density / fragmented day / focus blocks; предлагать конфликты; не менять внешний календарь.
8. Skills: `daily-briefing`, `anomaly-watch`, `meeting-prep`, `meeting-followup`, `contact-context-briefing`, `calendar-scheduling`, `focus-time-protection` (+ согласовать `meeting-notes`, `correspondence`).
9. Тесты: timezone, duplicate briefing suppression, commitment inclusion, anomaly thresholds, meeting context, no-calendar behavior, no false claims.

## Фаза 3 — Finance + Documents + CRM (этап 4)

1. **expense-invoice-tracking** — `Expense`-модель + сервис (OCR → структура → confidence → confirm).
2. **transaction-categorization** — user rules → история → model → confirm; исправления = learning signal.
3. **invoice-followup** — `Invoice`-модель + cron due/overdue; reminder = draft; отправка = approval.
4. **financial-report** — агрегационный сервис (детерминированные суммы по категориям/вендорам/периодам) + `generate_report`; weekly/monthly; сравнение с прошлым периодом.
5. **document-intake-ocr** — pipeline image/PDF/scan → OCR/vision → structured → confidence → storage.
6. **document-drafting** — LLM drafting (письма/мемо/памятки), отдельно от фикс. шаблонов.
7. **client-notes-crm** — расширить `ClientNotesService`: structured identity, tags, last-interaction, open commitments, provenance.
8. Skills: `expense-invoice-tracking`, `transaction-categorization`, `invoice-followup`, `financial-report`, `document-intake-ocr`, `document-drafting`, `client-notes-crm` (+ `sales-report`, `meeting-minutes` уже есть).
9. Тесты: arithmetic, currency, duplicate invoices, categories, due dates, overdue, report totals, OCR confidence, client/user isolation.

## Фаза 4 — Connector-ready architecture (этап 5)

1. **Capability contract** — `ExternalCapability` (email/calendar/travel/crm/accounting read/write); skill проверяет capability; отсутствие → локальный fallback + честное сообщение.
2. **Capability registry** — machine-readable: какие capabilities доступны, какие skills degraded, какие действия требуют approval.
3. **correspondence** — draft/tone/recipient context/approval; отправка только с connector.
4. **inbox-triage** — workflow email→classify→priority→summarize→action/draft (без Gmail-чтения).
5. **travel-coordination** — `TravelItem` + itinerary (trip → flight/hotel/transfer/reminders) + cron; booking НЕ реализовывать.
6. **MCP boundary** — архитектурный задел, без привязки к vendor.
7. Skills: `correspondence`, `inbox-triage`, `travel-coordination`.
8. Тесты: no false success, draft fallback, clear limitation, approval applies, local data works.

## Фаза 5 — Canonical skill catalog + workflow graph (этап 6)

1. Проверить все 25 skills в `packages/skills` + регистрацию в registry.
2. Единый frontmatter + структура каждого SKILL.md (Purpose/Activation/Context/Workflow/Tools/Memory/Approval/Failure/Connector/Examples/Do-not).
3. Workflow graphs: Meeting lifecycle, Finance lifecycle, Executive lifecycle.
4. `docs/GRISHA_SKILLS.md` — полный каталог со статусами/triggers/dependencies/tools/storage/connector/approval.

## Фаза 6 — Full QA (этап 7)

1. Build gate: `npm install`, `typecheck`, `test`, `build`.
2. Static verification: нет секретов, `.env`, hardcoded keys, fake external success, TODO вместо логики, duplicate services/registries.
3. Skill verification для всех 25 skills.
4. Safety scenarios S1–S10.
5. Data isolation: user A ≠ user B; commitments/notes/policies scoped.
6. Cron safety: duplicate jobs/briefings, timezone, retry, no spam, monitorMode не мутирует данные.
7. `docs/GRISHA_SKILLS_FINAL_REPORT.md` — таблица `Skill | Status | Runtime | Tests | Connector | Approval` со статусами `READY | PARTIAL | BLOCKED_BY_CONNECTOR`.

## Порядок работ

Фазы идут строго последовательно; следующая начинается только после зелёных
`typecheck`/`test` предыдущей. Каждая фаза фиксируется отдельным коммитом.
