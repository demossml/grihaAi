/**
 * C3/C4/C6: timeout обёртка, clip, fallback сообщения; bridge timeout → одно
 * короткое сообщение; пустой ответ → fallback. Стиль — в skill + STYLE_BLOCK.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TurnTimeoutError,
  clipTelegramText,
  withTurnTimeout,
  TURN_TIMEOUT_MESSAGE,
} from "../../.pi/extensions/telegram-bot/agent-turn-timeout.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

describe("withTurnTimeout", () => {
  it("work резолвится → значение", async () => {
    const v = await withTurnTimeout(1_000, async () => 42);
    assert.equal(v, 42);
  });

  it("work висит → TurnTimeoutError", async () => {
    await assert.rejects(
      withTurnTimeout(30, async () => {
        await new Promise((r) => setTimeout(r, 300));
        return 1;
      }),
      TurnTimeoutError,
    );
  });

  it("timeout передаёт AbortSignal в work", async () => {
    let signalSeen = false;
    const v = await withTurnTimeout(1_000, async (signal) => {
      signalSeen = signal instanceof AbortSignal;
      return 7;
    });
    assert.equal(v, 7);
    assert.equal(signalSeen, true);
  });
});

describe("clipTelegramText", () => {
  it("короткий текст не режется", () => {
    assert.equal(clipTelegramText("ок", 100), "ок");
  });
  it("длинная простыня обрезается с маркером", () => {
    const long = "а".repeat(5000);
    const out = clipTelegramText(long, 4000);
    assert.ok(out.length <= 4000);
    assert.ok(out.includes("(сокращено)"));
  });
});

describe("bridge timeout + empty reply (C4/§4)", () => {
  it("агент завис → одно короткое сообщение, без падения", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { text: "поздно" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      { agentTurnTimeoutMs: 40 },
    );
    const res = await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999, type: "private" }, text: "привет" },
    });
    assert.equal(res.handled, true);
    assert.deepEqual(sent, [TURN_TIMEOUT_MESSAGE]);
  });

  it("пустой ответ без файла → «Пустой ответ…» (§4)", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "" }),
      async (_chatId, text) => {
        sent.push(text);
      },
    );
    await bridge.handleUpdate({
      updateId: 2,
      message: { from: { id: 123 }, chat: { id: 999, type: "private" }, text: "привет" },
    });
    assert.deepEqual(sent, ["Пустой ответ. Переформулируйте вопрос."]);
  });

  it("attachmentOnly + файл НЕ заменяется пустым-фолбэком", async () => {
    const sent: Array<{ text: string; filePath?: string }> = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "", filePath: "/tmp/x.pdf", attachmentOnly: true }),
      async (_chatId, text, fp) => {
        sent.push({ text, filePath: fp });
      },
    );
    await bridge.handleUpdate({
      updateId: 3,
      message: { from: { id: 123 }, chat: { id: 999, type: "private" }, text: "отчёт" },
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, "");
    assert.equal(sent[0].filePath, "/tmp/x.pdf");
  });
});

describe("skill / style presence (C1/C7)", () => {
  it("core SKILL.md содержит Response style секцию", () => {
    const p = new URL(
      "../../../../packages/skills/skills/core/SKILL.md",
      import.meta.url,
    );
    const text = fs.readFileSync(p, "utf8");
    assert.ok(text.includes("Response style (Telegram)"), "skill секция есть");
    assert.ok(text.includes("concise"), "краткость зафиксирована");
  });
});
