/**
 * Mention detection — чистые функции (без grammy).
 * D1: поддерживает и entities (текст), и caption_entities (подпись к фото/документу).
 */

export interface MentionEntity {
  type?: string;
  offset?: number;
  length?: number;
  user?: { id?: number };
}

export interface MentionFlags {
  botMentioned: boolean;
  startsWithOtherMention: boolean;
}

/**
 * self без username → match по username невозможен (documented behavior);
 * text_mention по id работает всегда.
 */
export function collectMentionFlags(
  text: string,
  entities: MentionEntity[],
  self?: { id: number; username?: string },
): MentionFlags {
  let botMentioned = false;
  let startsWithOtherMention = false;
  for (const e of entities) {
    const offset = e.offset ?? 0;
    const length = e.length ?? 0;
    const mentionText = text.slice(offset, offset + length);
    if (e.type === "mention") {
      const isSelf = Boolean(
        self?.username && mentionText.toLowerCase() === `@${self.username}`.toLowerCase(),
      );
      if (isSelf) botMentioned = true;
      else if (offset === 0) startsWithOtherMention = true;
    } else if (e.type === "text_mention") {
      if (self && e.user?.id === self.id) botMentioned = true;
      else if (offset === 0) startsWithOtherMention = true;
    }
  }
  return { botMentioned, startsWithOtherMention };
}

/**
 * Объединить флаги текста и caption (D1): botMentioned — ИЛИ;
 * startsWithOtherMention — если хотя бы один источник начинается с чужого @.
 */
export function mergeMentionFlags(a: MentionFlags, b: MentionFlags): MentionFlags {
  return {
    botMentioned: a.botMentioned || b.botMentioned,
    startsWithOtherMention: a.startsWithOtherMention || b.startsWithOtherMention,
  };
}
