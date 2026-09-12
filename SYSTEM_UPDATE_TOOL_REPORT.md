# SYSTEM UPDATE TOOL — безопасное обновление кода Гриши с GitHub

Дата: 2026-09-12 (repo: grihaAi, ветка main)
Спека: SYSTEM UPDATE (U1–U13). Только update-path; Telegram ACL/PDF/parser не тронуты.

## Компоненты
- `apps/agent/src/services/system/update-service.ts` — чистая логика:
  `findRepoRoot` (GRIHA_REPO_DIR или вверх до .git), `assertSafeDirs` (repo ≠ data,
  data не git-репо, repo не внутри data), `guardExec` (blacklist reset/clean/push/
  rebase/filter-branch/rm), `runSafeUpdate`, `createRestartRequester`,
  `createUpdateLogger`, `isOwnerCheck`.
- `apps/agent/.pi/extensions/system-update/index.ts` — tool `system_update
  {confirm:true}` + `runUpdateCommand` (/update), deps из env/автодетекта.
- `scripts/griha-update.sh` (chmod +x) — то же одним скриптом.
- `docs/SYSTEM-UPDATE.md` — документация (механика, ограничения, systemd).
- `tests/unit/system-update.test.ts` — 16 guardrail-тестов.

## Механика (U4–U8)
1. precheck: assertSafeDirs + `.git` существует + `git status --porcelain`
   (dirty → отказ ДО любого pull) + `rev-parse HEAD` + ветка (detached → отказ;
   имя по whitelist /^[A-Za-z0-9._\-\/]+$/);
2. `git fetch origin`;
3. `git pull --ff-only origin <branch>`;
4. `npm ci` (fallback `npm install`) только если менялись package*.json между sha;
5. `npx turbo run build` — при падении рестарт НЕ вызывается, лог в ответе;
6. рестарт: `GRIHA_RESTART_CMD` (sh -c) → flag
   `~/.grish-ai/runtime/restart.flag` → `process.exit(0)` только при
   `GRIHA_UPDATE_EXIT=1` (systemd Restart=always).
Все шаги логируются в stdout + `~/.grish-ai/logs/update.log` (append-only, U10).

## Access (U1)
- `/update` — только private; owner = role `owner` ИЛИ `config.ownerUserId`/
  `GRISHA_OWNER_ID` (`isOwnerCheck`). Группа → «Команда /update только в личке.»,
  не-owner → «Недостаточно прав.», admin/user не проходят.
- Tool `system_update` — требует `confirm:true` + owner; зарегистрирован в
  SUB_SESSION_EXTENSIONS (доступен в DM-сессии).
- Bridge: команда `/update` обрабатывается в canned-пути (до агента), option
  `updateCommandHandler` проброшен контроллером.

## Данные (U2/U3)
- git cwd = корень репозитория (не ~/.grish-ai); dataDir нигде не пишется/не
  удаляется, кроме append-лога и restart.flag.

## Тесты (16, мок exec — реальный git не трогается)
1. dirty → precheck, pull не вызван; 2. чистое дерево → fetch + `pull --ff-only
origin main` точными аргументами + build; 3. non-ff ошибка → restart 0;
4. build fail → restart 0; 5. успех → restart ровно 1; 6. lock-файлы менялись →
`npm ci`; 7. detached HEAD → отказ; 8. assertSafeDirs (same path / data-git /
repo inside data); 9. findRepoRoot; 10. guardExec blacklist; 11–14. isOwnerCheck
(ownerUserId, role owner, admin/user deny).

**Итог: 786 unit-тестов PASS** (было 770), `turbo typecheck` + `build` 12/12.

## Acceptance
- Owner в DM /update → pull ff-only → install (по необходимости) → build →
  restart requested ✅ (механика в service; ручной прогон на сервере)
- Non-owner → отказ ✅ (isOwnerCheck + /update)
- Группа → «только в личке» ✅
- Dirty repo → отказ без pull ✅
- ~/.grish-ai не трогается (кроме log/flag) ✅
- Tests green ✅

## OUT OF SCOPE
Автообновление по таймеру, multi-remote/произвольный URL, runner миграций БД,
Windows-сервис.
