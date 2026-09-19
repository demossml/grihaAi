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
