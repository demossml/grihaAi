import type {
  Anomaly,
  ApprovalRequestRecord,
  CalendarEvent,
  ClientNote,
  Commitment,
  Contact,
  Expense,
  Invoice,
} from "../types/index.js";
import { buildBriefing, localDayKey } from "../utils/briefing/briefing.js";
import { summarizeExpenses } from "../utils/finance/finance.js";
import { isAgentRuntimeEnabled } from "../runtime/index.js";
import {
  compactContext,
  estimateTokens,
  renderSummary,
  shouldCompress,
  usableBudget,
  type ChatMessage,
} from "../runtime/context/index.js";
import { InMemorySessionSummaryStore } from "../runtime/session/index.js";

/**
 * ContextBuilder — the single place that assembles relevant context for skills.
 *
 * Skills must NOT scan all of memory themselves. They ask the ContextBuilder
 * for a specific context; the builder pulls from the domain services and
 * formats it. It contains no skill business logic — only aggregation.
 */

export interface ContextReaders {
  getEvents(userId: string): CalendarEvent[];
  getCommitments(userId: string): Commitment[];
  getAnomalies(userId: string): Anomaly[];
  getApprovals(userId: string): ApprovalRequestRecord[];
  getClientNotes(userId: string, query?: string): Promise<ClientNote[]>;
  getContacts(userId: string): Contact[];
  getExpenses(userId: string): Expense[];
  getInvoices(userId: string): Invoice[];
}

export interface ContextResult {
  text: string;
  items: string[];
}

export class ContextBuilder {
  constructor(
    private readonly readers: ContextReaders,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly contextBudgetTokens = 8000,
    private readonly sessionKey?: string,
  ) {}

  /** C2: итеративная ре-компрессия summary по ключу сессии (in-memory). */
  private readonly summaries = new InMemorySessionSummaryStore();

  /**
   * W3: единый финишер ContextResult — при флаге применяет token-бюджет
   * (estimateTokens + shouldCompress); порядок items = приоритет.
   * Flag off: результат без изменений.
   */
  private finalize(items: string[]): ContextResult {
    const text = items.join("\n");
    if (!isAgentRuntimeEnabled(this.env)) return { text, items };
    const budget = usableBudget({ maxTokens: this.contextBudgetTokens, reservedTokens: 512 });
    const used = estimateTokens(text);
    if (used <= budget) return { text, items };
    const decision = shouldCompress(
      { usedTokens: used, budgetTokens: budget, turnCount: 10 },
      Date.now(),
      undefined,
    );
    if (decision.level === "none") return { text, items };

    // C2: структурная компакция середины (шаблон, без LLM — aux B5 позже).
    const summaryResult = this.compressWithSummary(items, budget, used);
    if (summaryResult) return summaryResult;

    // Fallback W3: приоритетное ужатие, если резюмировать нечего.
    const kept: string[] = [];
    let keptTokens = 0;
    for (const item of items) {
      const itemTokens = estimateTokens(item) + 1;
      if (kept.length > 0 && keptTokens + itemTokens > budget) break;
      kept.push(item);
      keptTokens += itemTokens;
    }
    kept.push(`…(контекст ужат: ${used} → ~${keptTokens} токенов)`);
    return { text: kept.join("\n"), items: kept };
  }

  /** C2: head (system) + rendered summary + tail (recent). */
  private compressWithSummary(
    items: string[],
    budget: number,
    used: number,
  ): ContextResult | null {
    const headCount = 1; // первый item — system-секция (порядок сборки §8)
    const tailCount = 8; // 4 turn'а × 2 сообщения
    const tailStart = Math.max(headCount, items.length - tailCount);
    const middleItems = items.slice(headCount, tailStart);
    if (middleItems.length === 0) return null;

    // Механическое извлечение: builder-префиксы списка убираются, чтобы
    // паттерны Decision/Question матчились на контенте (шаблон без LLM).
    const stripListPrefix = (s: string): string =>
      s.replace(/^\s*[-*]\s+(\[[^\]]*\]\s+)?/gm, "");
    const middleMessages: ChatMessage[] = middleItems.map((content, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: stripListPrefix(content),
    }));
    // C2: 4-фазный конвейер (prune → structural → summarize → merge).
    // recentTurns: 0 — tail уже отделён в ContextBuilder; middle идёт в резюме.
    const pipeline = compactContext(
      [{ role: "system", content: items[0] ?? "" }, ...middleMessages],
      {
        recentTurns: 0,
        previousSummary: this.summaries.get(this.sessionKey ?? "context")?.sections,
      },
    );
    // upsert делает повторное слияние с сохранённым summary (идемпотентно).
    const entry = this.summaries.upsert(
      this.sessionKey ?? "context",
      pipeline.summary,
    );
    const rendered = renderSummary(entry.sections);
    const finalItems = [
      ...items.slice(0, headCount),
      rendered,
      ...items.slice(tailStart),
      `…(контекст ужат: ${used} → ~${estimateTokens(rendered)} токенов резюме)`,
    ];
    const finalText = finalItems.join("\n");
    if (estimateTokens(finalText) > budget * 1.5) return null;
    return { text: finalText, items: finalItems };
  }

  async getContactContext(userId: string, contactName: string): Promise<ContextResult> {
    const notes = await this.readers.getClientNotes(userId, contactName);
    const commitments = this.readers
      .getCommitments(userId)
      .filter(
        (c) =>
          (c.toWhom && c.toWhom.toLowerCase().includes(contactName.toLowerCase())) ||
          (c.target && c.target.toLowerCase().includes(contactName.toLowerCase())) ||
          c.text.toLowerCase().includes(contactName.toLowerCase()),
      );
    const contact = this.readers
      .getContacts(userId)
      .find((c) => c.name.toLowerCase() === contactName.toLowerCase());

    const items: string[] = [`Контекст по контакту: ${contactName}`];
    if (contact) {
      items.push(
        `- Контакт: ${contact.name}${contact.tags.length ? ` [${contact.tags.join(", ")}]` : ""}${
          contact.lastInteractionAt ? ` (последнее взаимодействие: ${contact.lastInteractionAt.slice(0, 10)})` : ""
        }`,
      );
    }
    if (notes.length > 0) {
      items.push("- Заметки:");
      for (const n of notes) items.push(`  - ${n.content}`);
    }
    if (commitments.length > 0) {
      items.push("- Связанные обязательства:");
      for (const c of commitments) items.push(`  - [${c.status}] ${c.text}`);
    }
    if (items.length === 1) items.push("- Ничего не найдено.");
    return this.finalize(items);
  }

  async getMeetingContext(userId: string, eventId: string): Promise<ContextResult> {
    const event = this.readers.getEvents(userId).find((e) => e.id === eventId);
    const items: string[] = [];
    if (event) {
      items.push(`Встреча: ${event.title} (${event.startsAt} — ${event.endsAt}, ${event.timezone})`);
      if (event.participants.length > 0) items.push(`Участники: ${event.participants.join(", ")}`);
      if (event.location) items.push(`Место: ${event.location}`);
    } else {
      items.push("Событие не найдено.");
    }
    const open = this.readers
      .getCommitments(userId)
      .filter((c) => c.status !== "completed" && c.status !== "cancelled");
    if (open.length > 0) {
      items.push("Открытые обязательства:");
      for (const c of open) items.push(`- ${c.text}${c.deadline ? ` (до ${c.deadline.slice(0, 10)})` : ""}`);
    }
    const notes = event ? await this.readers.getClientNotes(userId, event.title) : [];
    if (notes.length > 0) {
      items.push("Заметки по теме:");
      for (const n of notes) items.push(`- ${n.content}`);
    }
    return this.finalize(items);
  }

  async getDailyBriefingContext(userId: string, timezone = "UTC"): Promise<ContextResult> {
    const now = new Date();
    const commitments = this.readers.getCommitments(userId);
    const { text } = buildBriefing({
      events: this.readers.getEvents(userId),
      commitments,
      anomalies: this.readers.getAnomalies(userId).filter((a) => a.status === "new"),
      approvals: this.readers.getApprovals(userId).filter((a) => a.status === "pending"),
      clientNotes: await this.readers.getClientNotes(userId),
      now,
      timezone,
    });
    return this.finalize(text.split("\n"));
  }

  getFinancialContext(userId: string): ContextResult {
    const expenses = this.readers.getExpenses(userId);
    const invoices = this.readers.getInvoices(userId);
    const summary = summarizeExpenses(expenses);
    const items: string[] = [
      `Финансы: всего расходов ${summary.total} (${summary.count})`,
    ];
    for (const [cat, total] of Object.entries(summary.byCategory)) {
      items.push(`- ${cat}: ${total}`);
    }
    const overdue = invoices.filter((i) => i.status === "overdue");
    if (overdue.length > 0) {
      items.push("Просроченные счета:");
      for (const i of overdue) items.push(`- ${i.number} ${i.amount} ${i.currency}`);
    }
    return this.finalize(items);
  }

  getCommitmentContext(userId: string): ContextResult {
    const commitments = this.readers.getCommitments(userId);
    const items: string[] = [];
    const open = commitments.filter((c) => c.status === "open");
    const due = commitments.filter((c) => c.status === "due_soon");
    const overdue = commitments.filter((c) => c.status === "overdue");
    if (overdue.length > 0) {
      items.push("Просрочено:");
      for (const c of overdue) items.push(`- ${c.text}`);
    }
    if (due.length > 0) {
      items.push("Скоро:");
      for (const c of due) items.push(`- ${c.text}`);
    }
    if (open.length > 0) {
      items.push("Открыто:");
      for (const c of open) items.push(`- ${c.text}`);
    }
    if (items.length === 0) items.push("Обязательств нет.");
    return this.finalize(items);
  }
}

export { localDayKey };
