# System update

Безопасное самообновление Griha с GitHub и перезапуск.

## Repo (зашит)

- `demossml/grihaAi`, ветка `main`. URL из текста пользователя **не принимается**.
- При старте проверяется `git remote get-url origin` → должен указывать на
  `github.com/demossml/grihaAi` (https или ssh). Иначе `WRONG_REMOTE`.

## Команды

- Telegram: `/update` (запустить), `/update status` (показать sha/branch/dirty).
  Только private + owner (`config.ownerUserId` / `GRISHA_OWNER_ID`).
- Tool агента: `system_update` (`action: "status" | "run"`), только owner.
- CLI (локально, owner не обязателен):

```bash
npm run system-update -w @griha/agent            # run
npm run system-update:status -w @griha/agent     # status
```

## Поведение

| Состояние | Результат |
|---|---|
| git working tree dirty | `DIRTY` — отказ, без pull |
| build упал | `BUILD` — без restart |
| origin другой | `WRONG_REMOTE` |
| owner не настроен / не owner | `DENY` |
| уже актуально | ok, `restarted: false` |
| новые коммиты + build ok | ok, restart (systemd) |

## Restart

- Команда по умолчанию: `systemctl --user restart griha-ai`.
- Переопределение: `GRIHA_RESTART_CMD` (строка, split по пробелам).

## Данные

`~/.grish-ai/**` (sqlite, chat-setup, sessions, obs, config) **не трогаются**.
Обновление — только `git fetch` + `git merge --ff-only origin/main` (без
force push / reset --hard).

## Связь

- `apps/agent/src/services/update/` — `SystemUpdateService`, `constants`, `types`, `owner`, `cli`.
- Emit obs: `system_update.start` / `system_update.end`.
