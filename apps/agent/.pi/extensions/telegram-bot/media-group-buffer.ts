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
  groupId: string;
  items: AlbumItem[];
  /** Общая подпись: обычно только у одного элемента альбома. */
  caption?: string;
}

export type AlbumFlushFn = (batch: AlbumBatch) => void | Promise<void>;

export class MediaGroupBuffer {
  private readonly pending = new Map<
    string,
    { items: AlbumItem[]; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly flushMs = 1000,
    private readonly onFlush: AlbumFlushFn,
  ) {}

  add(groupId: string, item: AlbumItem): void {
    const entry = this.pending.get(groupId);
    if (entry) {
      clearTimeout(entry.timer);
      entry.items.push(item);
    } else {
      this.pending.set(groupId, { items: [item], timer: undefined as never });
    }
    const current = this.pending.get(groupId)!;
    current.timer = setTimeout(() => {
      void this.flush(groupId);
    }, this.flushMs);
    current.timer.unref?.();
  }

  private async flush(groupId: string): Promise<void> {
    const entry = this.pending.get(groupId);
    if (!entry) return;
    this.pending.delete(groupId);
    const items = entry.items;
    const caption = pickAlbumCaption(items);
    try {
      await this.onFlush({ groupId, items, caption });
    } catch (err: unknown) {
      console.error(
        "[media-group] album flush failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * P05: graceful shutdown — НЕ silent loss. Таймеры останавливаются, но
   * накопленные альбомы флашатся (onFlush) и дожидаются завершения.
   * Ошибки отдельного флаша логируются и не роняют shutdown.
   */
  async dispose(): Promise<void> {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, entry] of entries) clearTimeout(entry.timer);
    if (entries.length === 0) return;
    console.warn(
      `[media-group] dispose with ${entries.length} pending album(s) — flushing (no silent loss)`,
    );
    await Promise.all(
      entries.map(([groupId, entry]) =>
        Promise.resolve(
          this.onFlush({
            groupId,
            items: entry.items,
            caption: pickAlbumCaption(entry.items),
          }),
        ).catch((err: unknown) => {
          console.error(
            `[media-group] dispose flush failed for ${groupId}:`,
            err instanceof Error ? err.message : err,
          );
        }),
      ),
    );
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
