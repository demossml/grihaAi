/**
 * G1 — буфер медиа-альбомов (media_group_id).
 *
 * Telegram шлёт альбом как N независимых update с одним media_group_id
 * (разница миллисекунды). Буфер накапливает элементы и сбрасывает их одним
 * логическим batch'ем после тишины (default 1000 мс): один job, shared
 * caption, максимум один ход агента.
 */

export type AlbumItemKind = "photo" | "document" | "voice" | "video" | "video_note" | "audio";

export interface AlbumItem {
  updateId: number;
  messageId: number;
  fileId: string;
  fileUniqueId: string;
  kind: AlbumItemKind;
  mimeType?: string;
  caption?: string;
  duration?: number;
}

export interface AlbumBatch {
  /** PROMPT 10: чат альбома — lookup gate-контекста по composite-ключу. */
  chatId: string;
  /** Сырой media_group_id (для agent message `telegram_media_group_id`). */
  groupId: string;
  items: AlbumItem[];
  /** Общая подпись: обычно только у одного элемента альбома. */
  caption?: string;
}

export type AlbumFlushFn = (batch: AlbumBatch) => void | Promise<void>;

/**
 * PROMPT 10: canonical scope-ключ альбома — chatId + mediaGroupId.
 * media_group_id уникален только в контексте чата; без chatId альбомы
 * РАЗНЫХ чатов с совпавшим id слились бы в один batch.
 */
export function mediaGroupScopeKey(chatId: string | number, groupId: string): string {
  return `${String(chatId)}:${groupId}`;
}

export class MediaGroupBuffer {
  private readonly pending = new Map<
    string,
    { chatId: string; groupId: string; items: AlbumItem[]; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly flushMs = 1000,
    private readonly onFlush: AlbumFlushFn,
  ) {}

  /** PROMPT 10: item буферизуется под composite-ключом (chatId + groupId). */
  add(chatId: string | number, groupId: string, item: AlbumItem): void {
    const key = mediaGroupScopeKey(chatId, groupId);
    const entry = this.pending.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      entry.items.push(item);
    } else {
      this.pending.set(key, {
        chatId: String(chatId),
        groupId,
        items: [item],
        timer: undefined as never,
      });
    }
    const current = this.pending.get(key)!;
    current.timer = setTimeout(() => {
      void this.flush(key);
    }, this.flushMs);
    current.timer.unref?.();
  }

  private async flush(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    const items = entry.items;
    const caption = pickAlbumCaption(items);
    try {
      // groupId в batch остаётся СЫРЫМ (для agent message и логов);
      // chatId — для lookup gate-контекста по composite-ключу.
      await this.onFlush({ chatId: entry.chatId, groupId: entry.groupId, items, caption });
    } catch (err: unknown) {
      console.error(
        "[media-group] album flush failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Остановить все таймеры (shutdown). */
  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }
}

/** Подпись альбома: caption первого непустого элемента (Telegram кладёт на один). */
export function pickAlbumCaption(items: AlbumItem[]): string | undefined {
  for (const item of items) {
    if (item.caption && item.caption.trim() !== "") return item.caption;
  }
  return undefined;
}
