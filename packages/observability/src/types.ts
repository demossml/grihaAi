export type ObsLevel = "debug" | "info" | "warn" | "error";

export interface ObsEvent {
  ts: string; // ISO
  level: ObsLevel;
  component: string; // e.g. "telegram.bot", "report.render"
  event: string; // e.g. "polling.started", "gate.block"
  correlationId?: string;
  chatId?: string;
  threadId?: string;
  userId?: string;
  messageId?: number;
  updateId?: number;
  sessionKey?: string;
  durationMs?: number;
  ok?: boolean;
  code?: string; // машинный код ошибки/логики
  data?: Record<string, unknown>; // уже redact-нутый
}

export interface ObsSink {
  write(event: ObsEvent): void | Promise<void>;
}
