/**
 * R3 — регрессионный E2E-набор пресетов (раз и навсегда).
 *
 * Для каждого presetId на реальных фикстурах hard-правил:
 *  A. pending → нет агента/архива;
 *  B. text без @ → listener архивирует; secretary/team агента нет;
 *  C. @mention → агент отвечает (only_me — только actor);
 *  D. policy media-флаги (OCR/archive) по матрице R1;
 *  E. assertCanReadChat (свёртка).
 * Запрет: parseTotal/PDF layout здесь не меняются.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserRule } from "@griha/shared-types";
import { PRESETS, type PresetId } from "../../.pi/extensions/chat-setup/RulePresets.js";
import {
  prepareGroupTurn,
  type PrepareTurnInput,
  type PrepareTurnResult,
} from "../../.pi/extensions/telegram-bot/group-runtime.js";
import { evaluatePreFilter } from "../../.pi/extensions/user-rules/prefilter.js";
import { formatRulesContext } from "../../.pi/extensions/user-rules/format-rules-context.js";
import { rulesToChatPolicy } from "../../.pi/extensions/user-rules/chat-policy.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import type { TgUpdate } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import {
  assertCanReadChat,
  type GroupAccessDeps,
} from "../../src/services/documents/groupHistoryTools.js";

const ALL_PRESETS: PresetId[] = [
  "safe_default",
  "team",
  "secretary",
  "listener",
  "shop",
  "only_me",
];

function hardRulesOf(id: PresetId, actorId = "42"): UserRule[] {
  const rules = PRESETS[id].rules.filter((r) => r.kind === "hard");
  if (id === "only_me") {
    rules.push({ key: "only_my_messages_user_id", value: actorId, kind: "hard" });
  }
  return rules.map((r, i) => ({
    id: `p-${id}-${i}`,
    scope: "chat",
    chatId: "-100",
    text: `${r.key} = ${String(r.value)}`,
    kind: "hard",
    enabled: true,
    createdAt: "t",
    updatedAt: "t",
    key: r.key,
    value: r.value,
  }));
}

function makePrepareTurn(id: PresetId, configured: boolean): (input: PrepareTurnInput) => PrepareTurnResult {
  return (input) =>
    prepareGroupTurn(input, {
      isGroupConfigured: () => configured,
      getHardRules: () => hardRulesOf(id),
      getSoftRules: () => [],
      evaluate: (rules, prefilterInput) => evaluatePreFilter(rules, prefilterInput),
      formatRules: (hard, soft) => formatRulesContext(hard, soft),
    });
}

interface Harness {
  agentCalls: number;
  archived: string[];
  sent: string[];
  mediaCalls: number;
}

function bridgeFor(id: PresetId, opts: { configured?: boolean; fromId?: number } = {}): {
  bridge: TelegramBridge;
  h: Harness;
} {
  const h: Harness = { agentCalls: 0, archived: [], sent: [], mediaCalls: 0 };
  const bridge = new TelegramBridge(
    [42],
    async () => {
      h.agentCalls++;
      return { text: "ответ" };
    },
    async (_chatId, text) => {
      h.sent.push(text);
    },
    {
      prepareTurn: makePrepareTurn(id, opts.configured ?? true),
      archiveHandler: async (msg) => {
        h.archived.push(msg.text ?? "");
        return { stored: true };
      },
      processMedia: async () => {
        h.mediaCalls++;
        return {};
      },
    },
  );
  return { bridge, h };
}

const groupMsg = (extra: Record<string, unknown> = {}): TgUpdate => ({
  updateId: 1,
  message: {
    from: { id: 42 },
    chat: { id: -100, type: "supergroup" },
    text: "обычное сообщение",
    ...extra,
  },
});

// ── A: pending → тишина для всех пресетов ─────────────────────────────────

describe("R3 A: pending группа — нет агента и архива", () => {
  for (const id of ALL_PRESETS) {
    it(`${id}: pending → agent=0, archive=0`, async () => {
      const { bridge, h } = bridgeFor(id, { configured: false });
      const res = await bridge.handleUpdate(groupMsg({ botMentioned: true }));
      assert.equal(res.handled, true);
      assert.equal(h.agentCalls, 0, `${id}: агент не должен вызываться`);
      assert.equal(h.archived.length, 0, `${id}: архив не должен писаться`);
    });
  }
});

// ── B: text без @ ─────────────────────────────────────────────────────────

describe("R3 B: text без mention", () => {
  it("listener: текст архивируется, агент нет", async () => {
    const { bridge, h } = bridgeFor("listener");
    const res = await bridge.handleUpdate(groupMsg());
    assert.equal(res.reason, "archived-silent");
    assert.deepEqual(h.archived, ["обычное сообщение"]);
    assert.equal(h.agentCalls, 0);
  });

  it("secretary: агент нет (текст без @ не архивируется — listen_only=false, документировано)", async () => {
    const { bridge, h } = bridgeFor("secretary");
    const res = await bridge.handleUpdate(groupMsg());
    assert.equal(res.handled, true);
    assert.equal(h.agentCalls, 0);
    assert.equal(h.archived.length, 0);
  });

  it("team: агент нет (require_mention)", async () => {
    const { bridge, h } = bridgeFor("team");
    await bridge.handleUpdate(groupMsg());
    assert.equal(h.agentCalls, 0);
  });
});

// ── C: @mention → агент ───────────────────────────────────────────────────

describe("R3 C: @mention → агент отвечает", () => {
  for (const id of ["safe_default", "team", "secretary", "listener", "shop"] as PresetId[]) {
    it(`${id}: @mention → agent=1`, async () => {
      const { bridge, h } = bridgeFor(id);
      const res = await bridge.handleUpdate(groupMsg({ botMentioned: true, text: "@bot привет" }));
      assert.equal(res.handled, true);
      assert.equal(h.agentCalls, 1, `${id}: агент должен ответить на @`);
    });
  }

  it("only_me: actor отвечает, посторонний — нет", async () => {
    const actor = bridgeFor("only_me", { fromId: 42 });
    await actor.bridge.handleUpdate(groupMsg({ from: { id: 42 }, botMentioned: true }));
    assert.equal(actor.h.agentCalls, 1);

    const stranger = bridgeFor("only_me", { fromId: 99 });
    await stranger.bridge.handleUpdate(groupMsg({ from: { id: 99 }, botMentioned: true }));
    assert.equal(stranger.h.agentCalls, 0);
  });
});

// ── D: media-флаги policy по матрице R1 ───────────────────────────────────

describe("R3 D: медиа без @ — OCR/архив по матрице", () => {
  it("listener: archive.photo/document + photoOcr/documentOcr = true", () => {
    const p = rulesToChatPolicy(hardRulesOf("listener"));
    assert.equal(p.archive.photo, true);
    assert.equal(p.archive.document, true);
    assert.equal(p.archive.text, true);
    assert.equal(p.processing.photoOcr, true);
  });

  it("secretary: фото/документы архивируются и OCR-ятся (без @), текст — только по @", () => {
    const p = rulesToChatPolicy(hardRulesOf("secretary"));
    assert.equal(p.archive.photo, true, "secretary архивирует фото без @");
    assert.equal(p.archive.document, true);
    assert.equal(p.processing.photoOcr, true, "OCR путь для фото включён");
    assert.equal(p.processing.documentOcr, true);
    assert.equal(p.archive.text, false, "текст архивируется только у listen_only");
  });

  it("team: как secretary (R1: archive_media + archive_ocr_ingest)", () => {
    const p = rulesToChatPolicy(hardRulesOf("team"));
    assert.equal(p.archive.photo, true);
    assert.equal(p.processing.photoOcr, true);
  });

  it("shop: OCR→expense есть, сырой архив фото — нет", () => {
    const p = rulesToChatPolicy(hardRulesOf("shop"));
    assert.equal(p.processing.photoOcr, true);
    assert.equal(p.archive.photo, false);
  });

  it("safe_default: без archive/OCR ключей", () => {
    const p = rulesToChatPolicy(hardRulesOf("safe_default"));
    assert.equal(p.archive.photo, false);
    assert.equal(p.processing.photoOcr, false);
  });

  it("secretary: bridge вызывает processMedia для фото без @ (путь OCR), агент нет", async () => {
    const { bridge, h } = bridgeFor("secretary");
    const res = await bridge.handleUpdate(
      groupMsg({ text: undefined, photo: [{ file_id: "p1", file_unique_id: "pu1" }] }),
    );
    assert.equal(h.mediaCalls, 1, "processMedia вызывается (внутри — policy R1: OCR+expense)");
    assert.equal(h.agentCalls, 0);
    assert.equal(res.handled, true);
  });
});

// ── E: assertCanReadChat (свёртка) ────────────────────────────────────────

describe("R3 E: assertCanReadChat", () => {
  const deps = (over: Partial<GroupAccessDeps> = {}): GroupAccessDeps => ({
    isConfiguredSync: () => true,
    canManage: async () => false,
    isAllowed: async () => false,
    listConfiguredChatIds: async () => [],
    ...over,
  });

  it("owner (canManage) → configured чат", async () => {
    assert.equal(await assertCanReadChat("1", "-100", deps({ canManage: async () => true })), true);
  });
  it("member своей группы (sourceChatId) → true", async () => {
    assert.equal(await assertCanReadChat("42", "-100", deps({ sourceChatId: "-100" })), true);
  });
  it("чужой чат → false", async () => {
    assert.equal(await assertCanReadChat("42", "-200", deps({ sourceChatId: "-100" })), false);
  });
  it("не configured → false", async () => {
    assert.equal(
      await assertCanReadChat("42", "-100", deps({ isConfiguredSync: () => false })),
      false,
    );
  });
});
