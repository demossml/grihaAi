/**
 * FIX: Expense reports in groups — parser (R1), full-history limit (R4),
 * кириллический PDF (R2), attachmentOnly + dedupe (R3).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTotalFromText } from "../../src/services/documents/extractors/parsers.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";
import { expensesListHandler } from "../../src/services/documents/expensesTools.js";
import {
  findRussianFontPath,
  renderExpensePdfRussian,
} from "../../src/utils/reports/russian-pdf.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import { TelegramSessionPool } from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { setSessionFile } from "../../src/utils/telegram/session-files.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// ── R1: парсер — НДС никогда не сумма ──────────────────────────────────────

describe("parseTotalFromText (R1: ИТОГ, не НДС)", () => {
  it("VAT не побеждает ИТОГ", () => {
    assert.equal(parseTotalFromText("НДС 22% 2339.51\nСУММА НДС 22% =1220.27\nИТОГ 20515.00"), 20515);
    assert.equal(parseTotalFromText("НДС 22%\nИТОГО =6767.00"), 6767);
    assert.equal(parseTotalFromText("НДС 22% 22.00\nИТОГ 175.00"), 175);
  });

  it("только строки НДС → undefined (не 22 и не 1220)", () => {
    assert.equal(parseTotalFromText("НДС 22% 2339.51\nСУММА НДС 22% =1220.27"), undefined);
  });

  it("старые позитивные кейсы сохранены", () => {
    assert.equal(parseTotalFromText("чек из Ромашки итого 15400 ₽"), 15400);
    assert.equal(parseTotalFromText("оплачено 1 500,50 руб"), 1500.5);
    assert.equal(parseTotalFromText("сумма: 99.90"), 99.9);
    assert.equal(parseTotalFromText("нет суммы"), undefined);
    assert.equal(parseTotalFromText(""), undefined);
  });

  it("НАЛИЧНЫМИ = фактическая оплата", () => {
    assert.equal(parseTotalFromText("НДС 20% 500.00\nНАЛИЧНЫМИ 2500.00"), 2500);
  });
});

// ── R4: полный период не режется лимитом ───────────────────────────────────

describe("expensesListHandler full history (R4)", () => {
  function makeRepo(): DocumentsRepository {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-rep-"));
    tmpDirs.push(dir);
    return new DocumentsRepository(path.join(dir, "documents.sqlite"));
  }

  const doc = (i: number): ExpenseDocument => ({
    id: `d${i}`,
    chatId: "-100",
    docDate: "2026-09-01",
    supplier: `Поставщик ${i}`,
    total: i,
    currency: "RUB",
    kind: "receipt",
    confidence: 1,
    needsReview: false,
    source: "telegram",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });

  it("60 записей «весь период» → все видны (старый лимит был 50)", async () => {
    const repo = makeRepo();
    for (let i = 1; i <= 60; i++) await repo.insert(doc(i));
    const text = await expensesListHandler({}, { chatId: "-100", userId: "42" }, repo);
    assert.ok(text.includes("Документов: 60"), text);
  });
});

// ── R2: кириллический PDF ──────────────────────────────────────────────────

describe("renderExpensePdfRussian (R2)", () => {
  it("рендерит PDF > 2КБ с кириллическим шрифтом (если шрифт есть)", async () => {
    const font = findRussianFontPath();
    if (!font) {
      console.warn("русский шрифт не найден — рендер-тест пропущен");
      return;
    }
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "exp-pdf-"));
    tmpDirs.push(out);
    const filePath = await renderExpensePdfRussian({
      title: "Расходы · -100",
      periodLabel: "весь период",
      rows: [
        { date: "2026-09-01", supplier: "Магнит", total: 125.5 },
        { date: "2026-09-02", supplier: "Леруа", total: 2000.02, needsReview: true },
      ],
      totalAmount: 2125.52,
      currency: "RUB",
      outputDir: out,
    });
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 2 * 1024, `PDF слишком мал: ${stat.size}`);
    const head = fs.readFileSync(filePath).subarray(0, 5).toString("latin1");
    assert.equal(head, "%PDF-");
  });

  it("без шрифта — явная ошибка, не пустой PDF", async () => {
    await assert.rejects(
      renderExpensePdfRussian({
        title: "t",
        periodLabel: "p",
        rows: [],
        totalAmount: 0,
        currency: "RUB",
        outputDir: os.tmpdir(),
        fontCandidates: ["/nonexistent/font.ttf"],
      }),
      /Нет кириллического шрифта для PDF/,
    );
  });
});

// ── R3: attachmentOnly — один файл, без текста ─────────────────────────────

describe("attachmentOnly (R3)", () => {
  it("bridge: attachmentOnly → 1× sendDocument-вызов с пустым текстом, без подписи", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "att-"));
    tmpDirs.push(tmp);
    const filePath = path.join(tmp, "report.pdf");
    fs.writeFileSync(filePath, "%PDF-fake");
    const sent: Array<{ text: string; filePath?: string; extra?: import("../../.pi/extensions/telegram-bot/TelegramBridge.js").TelegramSendExtra }> = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "лишний сопроводительный текст", filePath, attachmentOnly: true }),
      async (_chatId, text, fp, extra) => {
        sent.push({ text, filePath: fp, extra });
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999, type: "private" }, text: "отчёт" },
    });
    assert.equal(res.handled, true);
    assert.equal(sent.length, 1, "ровно один outbound");
    assert.equal(sent[0].text, "", "без текста");
    assert.equal(sent[0].filePath, filePath, "файл отправлен");
    assert.equal(sent[0].extra?.documentCaption, undefined, "без подписи");
  });
});

// ── R3: dedupeKey — повторная отправка гасится в пуле ─────────────────────

class FakeSession {
  listeners: Array<(event: unknown) => void> = [];
  prompts: string[] = [];
  lastText = "";
  sessionId: string;
  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }
  subscribe(l: (event: unknown) => void): () => void {
    this.listeners.push(l);
    return () => {
      const i = this.listeners.indexOf(l);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    this.lastText = "готово";
    for (const l of [...this.listeners]) l({ type: "agent_end", messages: [], willRetry: false });
  }
  getLastAssistantText(): string {
    return this.lastText;
  }
  get isStreaming(): boolean {
    return false;
  }
  dispose(): void {}
}

describe("pool dedupeKey (R3)", () => {
  it("тот же dedupeKey во второй ход — файл не отправляется повторно", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dedupe-"));
    tmpDirs.push(tmp);
    const filePath = path.join(tmp, "r.pdf");
    fs.writeFileSync(filePath, "%PDF");
    const pool = new TelegramSessionPool({
      sessionFactory: async () => new FakeSession("s1") as unknown as AgentSession,
    });

    setSessionFile("s1", filePath, undefined, { attachmentOnly: true, dedupeKey: "k1" });
    const first = await pool.handleMessage("tg:1:1", 1, "первый", { chatId: "1" });
    assert.equal(first.filePath, filePath);
    assert.equal(first.attachmentOnly, true);

    // Тот же файл/ключ перерегистрирован (повторный заход в обработчик).
    setSessionFile("s1", filePath, undefined, { attachmentOnly: true, dedupeKey: "k1" });
    const second = await pool.handleMessage("tg:1:1", 1, "второй", { chatId: "1" });
    assert.equal(second.filePath, undefined, "дубль подавлен");
    assert.equal(second.text, "");

    // Другой ключ — отправляется.
    setSessionFile("s1", filePath, undefined, { attachmentOnly: true, dedupeKey: "k2" });
    const third = await pool.handleMessage("tg:1:1", 1, "третий", { chatId: "1" });
    assert.equal(third.filePath, filePath, "новый dedupeKey проходит");
  });
});
