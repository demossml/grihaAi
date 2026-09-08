import type { transcribeVoice } from "@griha/stt";

/**
 * Data source for the admin endpoints. The fields map 1:1 onto what the agent
 * already exposes: `TelegramBotController.isRunning()`,
 * `TelegramSessionPool.activeCount()` / `listActiveUserIds()`, and
 * `CronService.listJobs().length`. When the API runs standalone (outside the
 * agent process) these providers are absent and the endpoints report zeros.
 */
export interface AgentStatusProvider {
  getStatus(): Promise<{
    telegramBotRunning: boolean;
    activeTelegramSessions: number;
    cronJobs: number;
  }>;
  listTelegramSessions(): Promise<Array<{ userId: string; sessionKey: string }>>;
}

export interface CreateAppOptions {
  /** Admin API key. Defaults to `loadConfig()?.adminApiKey` when absent. */
  apiKey?: string;
  /** Injectable STT bridge for tests; defaults to @griha/stt.transcribeVoice. */
  transcribe?: typeof transcribeVoice;
  /** Injectable status source for the admin endpoints. */
  statusProvider?: AgentStatusProvider;
}
