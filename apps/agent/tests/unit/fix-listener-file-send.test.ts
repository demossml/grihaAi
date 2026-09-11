/**
 * FIX package — Listener @mention silence (A1/A2) + reliable file send (B1/B2).
 * Acceptance:
 *  - prefilter block НЕ теряет archive/suppressReply (listener архивирует молча);
 *  - mention-матч устойчив к регистру и лишнему @;
 *  - resolveOutboundFile: storageKey из архива, filePath только внутри allowed roots.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRule } from "@griha/shared-types";
import {
  prepareGroupTurn,
  type PrepareTurnDeps,
} from "../../.pi/extensions/telegram-bot/group-runtime.js";
import { evaluatePreFilter } from "../../.pi/extensions/user-rules/prefilter.js";
import { formatRulesContext } from "../../.pi/extensions/user-rules/format-rules-context.js";
import {
  collectMentionFlags,
  normUser,
  type MentionEntity,
} from "../../.pi/extensions/telegram-bot/mentions.js";
import {
  defaultFileRoots,
  resolveOutboundFile,
} from "../../.pi/extensions/telegram-bot/file-send.js";

const rule = (key: string, value: string | boolean): UserRule => ({
  id: `r-${key}`,
  scope: "chat",
  chatId: "-100",
  text: `${key} = ${String(value)}`,
  kind: "hard",
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
  key,
  value,
});

const listenerDeps = (hard: UserRule[], configuredChatId = "-100"): PrepareTurnDeps => ({
  isGroupConfigured: (chatId) => chatId === configuredChatId,
  getHardRules: () => hard,
  getSoftRules: () => [],
  evaluate: (rules, input) => evaluatePreFilter(rules, input),
  formatRules: (h, s) => formatRulesContext(h, s),
});

const mention = (offset: number, length: number): MentionEntity => ({
  type: "mention",
  offset,
  length,
});

// ── A1: prefilter-block сохраняет archive/suppressReply ──────────────────────

describe("A1 prepareGroupTurn: archive/suppressReply не теряются при prefilter=false", () => {
  it("listen_only + без mention → process:false, archive:true, suppressReply:true", () => {
    const res = prepareGroupTurn(
      { chatId: "-100", userId: "42", chatType: "supergroup", isGroup: true, text: "просто текст" },
      listenerDeps([rule("listen_only", true)]),
    );
    assert.equal(res.process, false);
    assert.equal(res.reason, "prefilter");
    assert.equal(res.archive, true, "archive должен пережить блокировку агента");
    assert.equal(res.suppressReply, true);
  });

  it("listen_only + @mention → process:true, archive:true", () => {
    const res = prepareGroupTurn(
      { chatId: "-100", userId: "42", chatType: "supergroup", isGroup: true, text: "@bot привет", botMentioned: true },
      listenerDeps([rule("listen_only", true)]),
    );
    assert.equal(res.process, true);
    assert.equal(res.archive, true);
    assert.equal(res.suppressReply, false);
  });

  it("pending группа остаётся полностью блокированной (archive не протекает)", () => {
    const res = prepareGroupTurn(
      { chatId: "-999", userId: "42", chatType: "supergroup", isGroup: true, text: "привет", botMentioned: true },
      listenerDeps([rule("listen_only", true)]),
    );
    assert.equal(res.process, false);
    assert.equal(res.reason, "group-not-configured");
    assert.equal(res.archive, false);
    assert.equal(res.suppressReply, false);
  });
});

// ── A2: mention-матч с нормализацией username ────────────────────────────────

describe("A2 collectMentionFlags: normUser (case-insensitive, с/без @)", () => {
  it("normUser снимает ведущий @ и приводит к lower case", () => {
    assert.equal(normUser("@GrishaBot"), "grishabot");
    assert.equal(normUser("grishaBOT"), "grishabot");
    assert.equal(normUser("@GRISHA_BOT"), "grisha_bot");
  });

  it("mention в другом регистре → botMentioned", () => {
    const flags = collectMentionFlags(
      "@GRISHA_BOT привет",
      [mention(0, 11)],
      { id: 1, username: "grisha_bot" },
    );
    assert.equal(flags.botMentioned, true);
  });

  it("mention с @, username без @ → botMentioned", () => {
    const flags = collectMentionFlags(
      "@grisha_bot привет",
      [mention(0, 11)],
      { id: 1, username: "grisha_bot" },
    );
    assert.equal(flags.botMentioned, true);
  });

  it("чужая mention → startsWithOtherMention, бот не упомянут", () => {
    const flags = collectMentionFlags(
      "@ivan привет",
      [mention(0, 5)],
      { id: 1, username: "grisha_bot" },
    );
    assert.equal(flags.botMentioned, false);
    assert.equal(flags.startsWithOtherMention, true);
  });

  it("self без username → mention-матч не работает (documented)", () => {
    const flags = collectMentionFlags("@grisha_bot", [mention(0, 11)], { id: 1 });
    assert.equal(flags.botMentioned, false);
  });
});

// ── B1/B2: resolveOutboundFile + allowed roots ───────────────────────────────

describe("B1 resolveOutboundFile", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fix-file-send-"));

  it("storageKey → путь из resolver, source=storage (не filePath)", async () => {
    const abs = path.join(tmp, "archived.pdf");
    fs.writeFileSync(abs, "x");
    const res = await resolveOutboundFile(
      { storageKey: "chat/-100/2026/07/abc.pdf" },
      {
        resolveStorageKey: async (key) => (key.includes("abc.pdf") ? abs : null),
        allowedRoots: [tmp],
      },
    );
    assert.equal(res.source, "storage");
    assert.equal(res.absolutePath, abs);
  });

  it("storageKey не найден → throw storageKey not found", async () => {
    await assert.rejects(
      resolveOutboundFile(
        { storageKey: "no/such/key" },
        { resolveStorageKey: async () => null, allowedRoots: [tmp] },
      ),
      /storageKey not found/,
    );
  });

  it("filePath внутри корня → ok", async () => {
    const f = path.join(tmp, "report.txt");
    fs.writeFileSync(f, "r");
    const res = await resolveOutboundFile({ filePath: f }, { allowedRoots: [tmp], resolveStorageKey: async () => null });
    assert.equal(res.source, "path");
    assert.equal(res.absolutePath, path.resolve(f));
  });

  it("filePath вне корней → throw path not in allowed roots", async () => {
    await assert.rejects(
      resolveOutboundFile(
        { filePath: "/etc/passwd" },
        { allowedRoots: [tmp], resolveStorageKey: async () => null },
      ),
      /path not in allowed roots/,
    );
  });

  it("filePath внутри корня, но файла нет → throw file not found", async () => {
    await assert.rejects(
      resolveOutboundFile(
        { filePath: path.join(tmp, "ghost.txt") },
        { allowedRoots: [tmp], resolveStorageKey: async () => null },
      ),
      /file not found/,
    );
  });

  it("без filePath и storageKey → throw Provide filePath or storageKey", async () => {
    await assert.rejects(
      resolveOutboundFile({}, { allowedRoots: [tmp], resolveStorageKey: async () => null }),
      /Provide filePath or storageKey/,
    );
  });

  it("B2: defaultFileRoots включает repo root (../.. от apps/agent) и config dir", () => {
    const roots = defaultFileRoots().map((r) => path.resolve(r));
    const repoRoot = path.resolve(process.cwd(), "../..");
    assert.ok(
      roots.some((r) => r === repoRoot),
      `repo root ${repoRoot} должен быть в allowed roots`,
    );
    assert.ok(roots.includes(os.tmpdir()), "tmp разрешён");
    assert.ok(roots.some((r) => r.includes("grish-ai")), "config dir разрешён");
    // /etc и /home НЕ разрешены целиком.
    assert.ok(!roots.includes("/"), "корень ФС не разрешён");
    assert.ok(!roots.includes("/home"), "/home не разрешён целиком");
  });
});
