/**
 * Typing indicator heartbeat — «три точки», пока идёт реальная обработка
 * (STT/OCR/LLM/tools). Telegram гасит sendChatAction(typing) через ~5с,
 * поэтому пульс повторяется каждые intervalMs (default 4000).
 *
 * Запускается ТОЛЬКО после того, как pipeline разрешил ход (не silent):
 * pending-группа / ACL deny / prefilter block — без typing.
 */
export interface TypingHeartbeatDeps {
  sendChatAction: (
    chatId: number,
    action: "typing",
    extra?: { messageThreadId?: number },
  ) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  /** default 4000 */
  intervalMs?: number;
}

export interface TypingHeartbeatHandle {
  /** Signal stop; resolves when loop exits */
  stop: () => Promise<void>;
}

/**
 * Сразу шлёт typing, затем каждые intervalMs, пока не stop().
 * Ошибки sendChatAction глотаются (бот кикнут / сеть) — не роняют agent path.
 */
export function startTypingHeartbeat(
  chatId: number,
  threadId: string | undefined,
  deps: TypingHeartbeatDeps,
): TypingHeartbeatHandle {
  const intervalMs = deps.intervalMs ?? 4000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let active = true;

  const pulse = async (): Promise<void> => {
    while (active) {
      try {
        await deps.sendChatAction(chatId, "typing", {
          messageThreadId: threadId !== undefined ? Number(threadId) : undefined,
        });
      } catch {
        // бот кикнут/сеть — игнорируем, loop продолжает работать до stop()
      }
      if (!active) break;
      await sleep(intervalMs);
    }
  };

  const done = pulse();

  return {
    stop: async () => {
      active = false;
      await done;
    },
  };
}
