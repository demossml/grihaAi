/**
 * P04 — TTL-кэш getChatMember (Bot API membership).
 *
 * Ключ `chatId:userId`, TTL 90s. Кэшируются ТОЛЬКО успешные статусы —
 * ошибки API не кэшируются (fail closed сохраняется). Инвалидация:
 * my_chat_member бота → сброс всего чата (kick участников Telegram update
 * не присылает — для них работает только TTL).
 */
export interface CachedMemberStatus {
  status: string;
  expiresAt: number;
}

export type RawGetChatMember = (
  chatId: number,
  userId: number,
) => Promise<{ status: string }>;

export class ChatMemberTtlCache {
  private readonly cache = new Map<string, CachedMemberStatus>();

  constructor(
    private readonly ttlMs = 90_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Обёртка над сырым getChatMember: успех — в кэш, ошибка — пробрасывается. */
  wrap(raw: RawGetChatMember): RawGetChatMember {
    return async (chatId, userId) => {
      const key = `${chatId}:${userId}`;
      const hit = this.cache.get(key);
      const now = this.now();
      if (hit && hit.expiresAt > now) return { status: hit.status };
      const res = await raw(chatId, userId);
      this.cache.set(key, { status: res.status, expiresAt: now + this.ttlMs });
      return res;
    };
  }

  /** Бот покинул/сменил статус в чате (my_chat_member) — контекст чата изменился. */
  invalidateChat(chatId: number): void {
    const prefix = `${chatId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  invalidate(chatId: number, userId: number): void {
    this.cache.delete(`${chatId}:${userId}`);
  }

  size(): number {
    return this.cache.size;
  }
}
