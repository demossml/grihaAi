# Обновление Гриши (system update)

- **Данные**: `~/.grish-ai` (config, users, rules, documents, media, telegram sessions) —
  НЕ в git, update их никогда не пишет/не удаляет (кроме append-only лога
  `~/.grish-ai/logs/update.log` и flag `~/.grish-ai/runtime/restart.flag`).
- **Код**: репозиторий приложения (`GRIHA_REPO_DIR`, иначе автодетект от cwd вверх
  до `.git`).
- **Команда**: `/update` в личке (только owner) или tool `system_update {confirm: true}`.
  Owner = роль `owner` в users.json ИЛИ `config.ownerUserId`/`GRISHA_OWNER_ID`.
  Группы и обычные admin/user — отказ.
- **Механика**: `git status` (dirty → отказ) → `git fetch` → `git pull --ff-only
  origin <branch>` → `npm ci` (только если менялись package*.json) → `npx turbo
  run build` → запрос рестарта. Build fail → рестарт не вызывается.
- **Запрещено**: reset, clean, push, rebase, filter-branch, rm; произвольный URL
  пользователя (remote = origin); detached HEAD.
- **Рестарт**: приоритет `GRIHA_RESTART_CMD` (sh -c) → flag-файл
  `~/.grish-ai/runtime/restart.flag` → `process.exit(0)` только при
  `GRIHA_UPDATE_EXIT=1`. Рекомендуется systemd `Restart=always`:
  `systemctl --user restart griha-agent.service`.
- **Shell**: `scripts/griha-update.sh` — то же самое одним скриптом.
- **Логи**: stdout + `~/.grish-ai/logs/update.log`.
