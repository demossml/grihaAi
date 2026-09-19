/**
 * scenarios — namespace сценариев (НЕ пресетов).
 *
 * Сценарий ≠ пресет: preset "secretary" отвечает по @/reply; scenario
 * "secretary" — тихий архив (≈ listener) + capabilities. Сценарий выбирается
 * отдельно и поверх применяет свой defaultPresetId, не меняя определение
 * пресета.
 */

export interface ScenarioCapabilities {
  archive: boolean;
  tasks: boolean;
  reminders: boolean;
  reports: boolean;
}

export interface ScenarioDef {
  id: string;
  title: string;
  /** Существующий preset key (RulePresets.PresetId), применяемый сценарием. */
  defaultPresetId: string;
  capabilities: ScenarioCapabilities;
}

const SCENARIOS: Record<string, ScenarioDef> = {
  secretary: {
    id: "secretary",
    title: "Сценарий: тихий секретарь",
    // NOT preset "secretary" — тихий архив = listener.
    defaultPresetId: "listener",
    capabilities: { archive: true, tasks: true, reminders: true, reports: true },
  },
};

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS[id];
}

export function listScenarios(): ScenarioDef[] {
  return Object.values(SCENARIOS);
}
