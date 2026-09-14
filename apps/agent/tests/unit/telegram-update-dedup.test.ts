/**
 * PROMPT 6: idempotency входящих Telegram updates (дизайн PROMPT 5).
 *
 * Покрытие (по §8 дизайна + списку PROMPT 6):
 *   repo: first/duplicate/concurrent/lease-reclaim/cleanup;
 *   service: bypass (TELEGRAM_UPDATE_DEDUP=0), fail-open;
 *   bridge: agent-invocation, edited, media, album (done на flush),
 *           forum topic, channel post, unrelated updates (no claim);
 *   migration: clean DB + existing DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DocumentsRepository,
  type UpdateClaimResult,
} from "../../src/services/documents/DocumentsRepository.js";
import {
  TelegramUpdateDedup,
  DEFAULT_UPDATE_LEASE_MS,
} from "../../src/services/documents/update-dedup.js";
import { ChatArchiveService } from "../../src/services/documents/chat-archive.js";
import type { DocumentExtractor } from "../../src/services/documents/extractors/types.js";
import {
  TelegramBridge,
  type TelegramUpdateGate,
} from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

/** Контролируемый gate: results по update_id + журналы вызовов. */
class FakeGate implements TelegramUpdateGate {
  claims: number[] = [];
  dones: number[] = [];
  results = new Map<number, UpdateClaimResult>();

  claim(updateId: number): UpdateClaimResult {
    this.claims.push(updateId);
    return this.results.get(updateId) ?? "ok";
  }

  markDone(updateId: number): void {
    this.dones.push(updateId);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("processed_updates repo (PROMPT 6)", () => {
  it("1. first update: claim ok → markDone → duplicate_done", () => {
    const repo = new DocumentsRepository(":memory:");
    assert.equal(repo.claimProcessedUpdate(1, 1000, DEFAULT_UPDATE_LEASE_MS), "ok");
    repo.markProcessedUpdateDone(1, 1000);
    assert.equal(repo.claimProcessedUpdate(1, 1000, DEFAULT_UPDATE_LEASE_MS), "duplicate_done");
  });

  it("2. duplicate пока lease свежий → duplicate_in_flight", () => {
    const repo = new DocumentsRepository(":memory:");
    assert.equal(repo.claimProcessedUpdate(7, 1000, 100), "ok");
    assert.equal(repo.claimProcessedUpdate(7, 1050, 100), "duplicate_in_flight");
  });

  it("3. concurrent duplicate: истёкший lease → reclaim ровно один раз", () => {
    const repo = new DocumentsRepository(":memory:");
    assert.equal(repo.claimProcessedUpdate(9, 1000, 100), "ok");
    // Первый reclaim побеждает (CAS), второй видит свежий claim снова.
    assert.equal(repo.claimProcessedUpdate(9, 1200, 100), "reclaimed");
    assert.equal(repo.claimProcessedUpdate(9, 1200, 100), "duplicate_in_flight");
  });

  it("4. crash/retry: claim → краш (без done) → истечение → reclaim → done", () => {
    const repo = new DocumentsRepository(":memory:");
    repo.claimProcessedUpdate(11, 1000, 100); // обработка началась и упала
    // Redelivery вскоре после краша — fresh claim → skip (in-flight).
    assert.equal(repo.claimProcessedUpdate(11, 1010, 100), "duplicate_in_flight");
    // После истечения lease — восстановление.
    assert.equal(repo.claimProcessedUpdate(11, 1200, 100), "reclaimed");
    repo.markProcessedUpdateDone(11, 1200);
    assert.equal(repo.claimProcessedUpdate(11, 1300, 100), "duplicate_done");
  });

  it("5. cleanup: завершённые строки старше TTL удаляются", () => {
    const repo = new DocumentsRepository(":memory:");
    repo.claimProcessedUpdate(21, 1000, 100);
    repo.markProcessedUpdateDone(21, 1100);
    repo.cleanupProcessedUpdates(2000);
    // Строка удалена → следующий claim снова ok.
    assert.equal(repo.claimProcessedUpdate(21, 3000, 100), "ok");
  });
});

describe("TelegramUpdateDedup service (PROMPT 6)", () => {
  it("6. disabled (TELEGRAM_UPDATE_DEDUP=0): claim всегда ok, done no-op", () => {
    const repo = new DocumentsRepository(":memory:");
    const dedup = new TelegramUpdateDedup(repo, () => 1000, { disabled: true });
    assert.equal(dedup.claim(1), "ok");
    dedup.markDone(1);
    // Без disabled тот же id дал бы duplicate_done — bypass реальный.
    assert.equal(dedup.claim(1), "ok");
    const enabled = new TelegramUpdateDedup(repo, () => 1000, {});
    assert.equal(enabled.claim(1), "ok");
    assert.equal(enabled.claim(1), "duplicate_in_flight");
  });

  it("7. fail-open: сбой storage не роняет claim/markDone", () => {
    const broken = {
      cleanupProcessedUpdates: () => {
        throw new Error("disk full");
      },
      claimProcessedUpdate: () => {
        throw new Error("disk full");
      },
      markProcessedUpdateDone: () => {
        throw new Error("disk full");
      },
    };
    const dedup = new TelegramUpdateDedup(
      broken as unknown as DocumentsRepository,
      () => 1000,
      {},
    );
    assert.equal(dedup.claim(5), "ok", "сообщение обрабатывается без дедупа");
    assert.doesNotThrow(() => dedup.markDone(5));
  });
});

describe("telegram bridge idempotency integration (PROMPT 6)", () => {
  const privateUpdate = (updateId: number, text: string, extra: Partial<Parameters<TelegramBridge["handleUpdate"]>[0]["message"]> = {}) => ({
    updateId,
    message: { from: { id: 1 }, chat: { id: 9, type: "private" }, text, ...extra },
  });

  it("8. agent invocation: дубль update_id → агент ровно один раз, done один раз", async () => {
    const gate = new FakeGate();
    const calls: string[] = [];
    const bridge = new TelegramBridge(
      [1],
      async (input) => {
        calls.push(input.message);
        return { text: "ок" };
      },
      async () => {},
      { updateGate: gate },
    );
    const r1 = await bridge.handleUpdate(privateUpdate(100, "привет"));
    assert.equal(r1.handled, true);
    gate.results.set(100, "duplicate_done");
    const r2 = await bridge.handleUpdate(privateUpdate(100, "привет"));
    assert.equal(r2.reason, "duplicate-duplicate_done");
    assert.equal(calls.length, 1, "агент вызван один раз");
    assert.deepEqual(gate.dones, [100], "markDone один раз");
  });

  it("9. crash/retry через bridge: reclaim → повторная обработка (агент снова вызывается)", async () => {
    const gate = new FakeGate();
    const calls: string[] = [];
    const bridge = new TelegramBridge(
      [1],
      async (input) => {
        calls.push(input.message);
        return { text: "ок" };
      },
      async () => {},
      { updateGate: gate },
    );
    gate.results.set(200, "reclaimed");
    await bridge.handleUpdate(privateUpdate(200, "снова"));
    assert.equal(calls.length, 1, "reclaim обрабатывается заново");
    assert.deepEqual(gate.dones, [200]);
  });

  it("10. ошибка обработки → markDone НЕ ставится", async () => {
    const gate = new FakeGate();
    const bridge = new TelegramBridge(
      [1],
      async () => {
        throw new Error("agent down");
      },
      async () => {},
      { updateGate: gate },
    );
    await assert.rejects(() => bridge.handleUpdate(privateUpdate(300, "бой")), /agent down/);
    assert.deepEqual(gate.dones, [], "done не ставится при ошибке");
    assert.deepEqual(gate.claims, [300]);
  });

  it("11. edited message: тот же message_id, новый update_id → оба хода", async () => {
    const gate = new FakeGate();
    const calls: string[] = [];
    const bridge = new TelegramBridge(
      [1],
      async (input) => {
        calls.push(input.message);
        return { text: "ок" };
      },
      async () => {},
      { updateGate: gate },
    );
    await bridge.handleUpdate(
      privateUpdate(401, "первая версия", { messageId: 55, isEdited: false }),
    );
    await bridge.handleUpdate(
      privateUpdate(402, "правка", { messageId: 55, isEdited: true }),
    );
    assert.equal(calls.length, 2, "правка — отдельный update_id — обрабатывается");
    assert.deepEqual(gate.dones, [401, 402]);
  });

  it("12. media (фото): дубль update_id → processMedia не вызывается повторно", async () => {
    const gate = new FakeGate();
    let mediaCalls = 0;
    const bridge = new TelegramBridge(
      [1],
      async () => ({ text: "ок" }),
      async () => {},
      {
        updateGate: gate,
        processMedia: async () => {
          mediaCalls++;
          return null;
        },
      },
    );
    const photoUpdate = (updateId: number) => ({
      updateId,
      message: {
        from: { id: 1 },
        chat: { id: 9, type: "private" },
        photo: [{ file_id: "F1", file_unique_id: "U1" }],
      },
    });
    await bridge.handleUpdate(photoUpdate(501));
    assert.equal(mediaCalls, 1);
    gate.results.set(501, "duplicate_in_flight");
    const r2 = await bridge.handleUpdate(photoUpdate(501));
    assert.equal(r2.reason, "duplicate-duplicate_in_flight");
    assert.equal(mediaCalls, 1, "медиа-конвейер не дублируется");
    assert.deepEqual(gate.dones, [501]);
  });

  it("13. album: buffered-элементы получают done только на flush альбома", async () => {
    const gate = new FakeGate();
    let albumCalls = 0;
    const bridge = new TelegramBridge(
      [1],
      async () => ({ text: "ок" }),
      async () => {},
      {
        updateGate: gate,
        albumBufferMs: 5,
        processMediaAlbum: async () => {
          albumCalls++;
          return { rawText: "ocr альбома" };
        },
      },
    );
    const albumUpdate = (updateId: number) => ({
      updateId,
      message: {
        from: { id: 1 },
        chat: { id: 9, type: "private" },
        mediaGroupId: "g1",
        photo: [{ file_id: `F${updateId}`, file_unique_id: `U${updateId}` }],
      },
    });
    const r1 = await bridge.handleUpdate(albumUpdate(601));
    const r2 = await bridge.handleUpdate(albumUpdate(602));
    assert.equal(r1.reason, "album-buffered");
    assert.equal(r2.reason, "album-buffered");
    // done элементов НЕ ставится на буферизацию…
    assert.deepEqual(gate.dones, []);
    // …а после флаша — на ВСЕ элементы батча.
    await sleep(30);
    assert.equal(albumCalls, 1, "альбом обработан один раз");
    assert.deepEqual([...gate.dones].sort((a, b) => a - b), [601, 602]);
  });

  it("14. forum topic: threadId проходит через gate-обёртку без изменений", async () => {
    const gate = new FakeGate();
    const seen: Array<{ threadId?: string }> = [];
    const bridge = new TelegramBridge(
      [1],
      async (input) => {
        seen.push({ threadId: input.threadId });
        return { text: "ок" };
      },
      async () => {},
      { updateGate: gate },
    );
    await bridge.handleUpdate({
      updateId: 701,
      message: {
        from: { id: 1 },
        chat: { id: 9, type: "supergroup" },
        threadId: "17",
        text: "в теме",
      },
    });
    assert.deepEqual(seen, [{ threadId: "17" }]);
    assert.deepEqual(gate.dones, [701]);
  });

  it("15. channel post (sender_chat): маршрут прежний, done ставится", async () => {
    const gate = new FakeGate();
    const agentCalls: string[] = [];
    const bridge = new TelegramBridge(
      [1],
      async (input) => {
        agentCalls.push(input.message);
        return { text: "ок" };
      },
      async () => {},
      { updateGate: gate },
    );
    const res = await bridge.handleUpdate({
      updateId: 801,
      message: {
        senderChat: { id: 777, title: "канал" },
        chat: { id: -100777, type: "channel" },
        text: "пост",
      },
    });
    assert.equal(res.handled, true);
    assert.equal(agentCalls.length, 0, "канал: агент не вызывается (без from)");
    assert.deepEqual(gate.dones, [801]);
  });

  it("16. unrelated updates: no-message / no-user → gate НЕ вызывается", async () => {
    const gate = new FakeGate();
    const bridge = new TelegramBridge([1], async () => ({ text: "x" }), async () => {}, {
      updateGate: gate,
    });
    const noMsg = await bridge.handleUpdate({ updateId: 901 } as never);
    assert.equal(noMsg.reason, "no-message");
    const noUser = await bridge.handleUpdate({
      updateId: 902,
      message: { chat: { id: 9, type: "private" }, text: "без отправителя" },
    });
    assert.equal(noUser.reason, "no-user");
    assert.deepEqual(gate.claims, [], "claim не делается для непроцессируемых апдейтов");
    assert.deepEqual(gate.dones, []);
  });
});

describe("processed_updates migration (PROMPT 6)", () => {
  it("17. clean DB: таблица создаётся и работает сразу", () => {
    const repo = new DocumentsRepository(":memory:");
    assert.equal(repo.claimProcessedUpdate(1, 1, DEFAULT_UPDATE_LEASE_MS), "ok");
    repo.markProcessedUpdateDone(1, 1);
    assert.equal(repo.claimProcessedUpdate(1, 1, DEFAULT_UPDATE_LEASE_MS), "duplicate_done");
  });

  it("18. existing DB: архив не теряется, таблица добавляется backward-compatible", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dedup-mig-"));
    const dbPath = path.join(dir, "documents.sqlite");
    try {
      const repo1 = new DocumentsRepository(dbPath);
      const archive = new ChatArchiveService(repo1, {} as DocumentExtractor);
      await archive.archiveText({
        chatId: "42",
        messageId: 7,
        text: "старое сообщение",
      });
      repo1.close();

      // «Обновление»: открытие существующей БД новой версией кода.
      const repo2 = new DocumentsRepository(dbPath);
      const archive2 = new ChatArchiveService(repo2, {} as DocumentExtractor);
      await archive2.archiveText({ chatId: "42", messageId: 7, text: "старое сообщение" });
      const rec = repo2.findArchiveByMessageId("42", "7");
      assert.ok(rec, "архивная запись сохранена");
      assert.equal(rec!.rawText, "старое сообщение");
      // Новая таблица работает на старой БД.
      assert.equal(repo2.claimProcessedUpdate(1, 1, DEFAULT_UPDATE_LEASE_MS), "ok");
      repo2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
