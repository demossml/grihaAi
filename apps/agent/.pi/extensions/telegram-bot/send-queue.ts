/**
 * Per-chat очередь исходящих сообщений (Пакет A).
 *
 * Сериализует sendMessage/sendDocument ТОЛЬКО внутри одного chat_id —
 * бурст в одну группу не улетает параллельными запросами (меньше 429),
 * при этом разные чаты не блокируют друг друга.
 */
export class ChatSendQueue {
  private tails = new Map<string, Promise<void>>();

  enqueue(chatId: string | number, task: () => Promise<void>): Promise<void> {
    const key = String(chatId);
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Выполнять даже если предыдущая задача упала (ошибка уже обработана вызывающим).
    const next = prev.then(task, task);
    this.tails.set(key, next.catch(() => undefined));
    return next;
  }

  /** Сколько чатов сейчас имеют хвост очереди (для диагностики/тестов). */
  pendingCount(): number {
    return this.tails.size;
  }
}
