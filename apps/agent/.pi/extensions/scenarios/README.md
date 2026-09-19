# Scenarios (сценарии)

Namespace сценариев — отделён от пресетов (`RulePresets`).

- **Preset** = набор hard/soft-правил (`RulePresets.ts`). `presetId "secretary"`
  отвечает по `@`/reply — его семантика **не меняется**.
- **Scenario** = режим работы поверх пресета. `id "secretary"` — «тихий архив»
  (≈ listener) + capabilities.

## API

- `getScenario(id): ScenarioDef | undefined`
- `listScenarios(): ScenarioDef[]`

## Зарегистрированные

| id | title | defaultPresetId | capabilities |
|----|-------|-----------------|--------------|
| `secretary` | Сценарий: тихий секретарь | `listener` | archive/tasks/reminders/reports — все true |

## Как добавить сценарий

1. Добавить запись в `SCENARIOS` (`registry.ts`).
2. `defaultPresetId` — существующий `PresetId` (`listener`/`team`/…).
3. Опционально — кнопка в онбординге (`RulePresets.buildOnboardingKeyboard`,
   action `s:<scenarioId>`) и обработчик `s:` в `chat-setup/handlers.ts`.

## ACL matrix (membership ≠ management)

| Действие | member (`isAllowed`) | owner/admin (`canManage`) | random user |
|----------|:---:|:---:|:---:|
| Говорить в группе (по правилам чата) | ✅ | ✅ | ❌ (по `aclMode`) |
| Читать историю своей группы (`group_history`/`assertCanReadChat`) | ✅ | ✅ | ❌ |
| Читать историю чужой группы | ❌ | ✅ | ❌ |
| Список всех групп в DM (`/groups`) | ❌ | ✅ | ❌ |
| Архив / активация / сценарий (`/group`) | ❌ | ✅ | ❌ |

- `assertCanReadChat` = `configured` **И** (`canManage` **ИЛИ** `isAllowed`).
- `canManage` = роль `owner`/`admin` (или main-сессия `"owner"`).
- `isAllowed` = user в ACL (не `blocked`, с учётом `chats`) ИЛИ `aclMode=open`.
- Архив чата (`status=archived`) = не configured → история недоступна даже member'у.
