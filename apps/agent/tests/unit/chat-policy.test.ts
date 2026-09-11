/**
 * PROMPT 06 — Chat Policy engine: версионированная policy, deterministic
 * evaluation, история, LLM structured extraction с валидацией.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRule } from "@griha/shared-types";
import {
  ChatPolicyStore,
  evaluateChatPolicy,
  evaluatePolicyFromRules,
  rulesToChatPolicy,
} from "../../.pi/extensions/user-rules/chat-policy.js";
import {
  extractPolicyPatch,
  policyPatchToRules,
  previewPolicyPatch,
  validatePolicyPatch,
} from "../../.pi/extensions/chat-setup/policy-extraction.js";

const tmpPaths: string[] = [];
afterEach(() => {
  while (tmpPaths.length) fs.rmSync(tmpPaths.pop()!, { recursive: true, force: true });
});

function rule(key: string, value: string | boolean): UserRule {
  return {
    id: `r-${key}`,
    scope: "chat",
    chatId: "-100",
    key,
    value,
    text: key,
    kind: "hard",
    enabled: true,
    createdAt: "t",
    updatedAt: "t",
  } as UserRule;
}

function makeStore(): ChatPolicyStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-policy-"));
  tmpPaths.push(dir);
  return new ChatPolicyStore(path.join(dir, "chat-policy.sqlite"));
}

describe("rulesToChatPolicy", () => {
  it("listener-пресет → mode=mention_or_reply, archive всё, processing всё", () => {
    const p = rulesToChatPolicy([
      rule("listen_only", true),
      rule("archive_media", true),
      rule("archive_ocr_ingest", true),
      rule("require_mention", true),
      rule("reply_to_bot", true),
      rule("ignore_bots", true),
      rule("ignore_service", true),
    ]);
    assert.equal(p.response.mode, "mention_or_reply");
    assert.deepEqual(p.archive, { text: true, photo: true, document: true, voice: true });
    assert.deepEqual(p.processing, {
      photoOcr: true,
      documentOcr: true,
      voiceStt: true,
      maxOcrPerHour: undefined,
      minFileSizeBytes: undefined,
      maxFileSizeBytes: undefined,
      skipIfNoDocumentHint: false,
    });
    assert.equal(p.agent.enabled, true);
  });

  it("team-пресет (require_mention+reply) → mention_or_reply, без архива", () => {
    const p = rulesToChatPolicy([rule("require_mention", true), rule("reply_to_bot", true)]);
    assert.equal(p.response.mode, "mention_or_reply");
    assert.equal(p.archive.text, false);
    assert.equal(p.processing.photoOcr, false);
  });

  it("require_mention без reply_to_bot → mention; без правил → always", () => {
    assert.equal(rulesToChatPolicy([rule("require_mention", true), rule("reply_to_bot", false)]).response.mode, "mention");
    assert.equal(rulesToChatPolicy([rule("require_mention", false), rule("reply_to_bot", false)]).response.mode, "always");
  });

  it("only_me → allowedUserIds + inbound.onlyFromUserIds", () => {
    const p = rulesToChatPolicy([
      rule("only_my_messages", true),
      rule("only_my_messages_user_id", "570"),
    ]);
    assert.deepEqual(p.response.allowedUserIds, ["570"]);
    assert.deepEqual(p.inbound?.onlyFromUserIds, ["570"]);
  });
});

const groupInput = (over: Record<string, unknown> = {}) => ({
  chatId: "-100",
  fromUserId: "42",
  text: "hi",
  isGroup: true,
  groupConfigured: true,
  ...over,
});

describe("evaluateChatPolicy (deterministic)", () => {
  const listener = {
    ...rulesToChatPolicy([
      rule("listen_only", true),
      rule("archive_media", true),
      rule("archive_ocr_ingest", true),
      rule("require_mention", true),
      rule("reply_to_bot", true),
    ]),
    version: 1,
  } as const;

  it("listener: текст без mention → archive, без агента", () => {
    const d = evaluateChatPolicy(listener, groupInput({ contentKind: "text" }));
    assert.equal(d.archive, true);
    assert.equal(d.invokeAgent, false);
    assert.equal(d.reply, false);
  });

  it("listener: фото без mention → archive + processMedia (OCR), без агента", () => {
    const d = evaluateChatPolicy(listener, groupInput({ contentKind: "photo" }));
    assert.equal(d.archive, true);
    assert.equal(d.processMedia, true);
    assert.equal(d.invokeAgent, false);
  });

  it("listener: @mention → агент вызывается", () => {
    const d = evaluateChatPolicy(
      listener,
      groupInput({ contentKind: "text", botMentioned: true }),
    );
    assert.equal(d.invokeAgent, true);
    assert.equal(d.reply, true);
  });

  it("pending → всё blocked, без архива", () => {
    const d = evaluateChatPolicy(
      listener,
      groupInput({ groupConfigured: false, contentKind: "photo" }),
    );
    assert.equal(d.archive, false);
    assert.equal(d.processMedia, false);
    assert.equal(d.invokeAgent, false);
    assert.equal(d.reason, "chat-not-configured");
  });

  it("канал: archive по policy, агента нет (нет user)", () => {
    const d = evaluateChatPolicy(
      listener,
      {
        chatId: "-300",
        fromUserId: "",
        text: "пост",
        isChannel: true,
        groupConfigured: true,
        contentKind: "text",
      },
    );
    assert.equal(d.archive, true);
    assert.equal(d.invokeAgent, false, "sender_chat не даёт agent-права");
  });

  it("ignore_bots и onlyFromUserIds — блокируют без архива", () => {
    const withIgnore = { ...listener, version: 1, inbound: { ignoreBots: true } };
    assert.equal(evaluateChatPolicy(withIgnore, groupInput({ fromIsBot: true })).reason, "bot-ignored");
    const onlyMe = { ...listener, version: 1, inbound: { onlyFromUserIds: ["570"] } };
    assert.equal(evaluateChatPolicy(onlyMe, groupInput()).reason, "only-from");
    assert.equal(
      evaluateChatPolicy(onlyMe, groupInput({ fromUserId: "570" })).reason,
      "archived-silent",
    );
  });

  it("evaluatePolicyFromRules: team без mention → policy-blocked", () => {
    const d = evaluatePolicyFromRules(
      [rule("require_mention", true), rule("reply_to_bot", true)],
      groupInput(),
    );
    assert.equal(d.invokeAgent, false);
    assert.equal(d.reason, "policy-blocked");
  });
});

describe("ChatPolicyStore (версии + история)", () => {
  it("record: version++ и строка в history", () => {
    const store = makeStore();
    const v1 = store.record("-100", rulesToChatPolicy([rule("listen_only", true)]), {
      source: "preset:listener",
      actorId: "570",
    });
    assert.equal(v1.version, 1);
    assert.equal(v1.source, "preset:listener");
    const v2 = store.record("-100", rulesToChatPolicy([rule("require_mention", true)]), {
      source: "custom",
      actorId: "570",
    });
    assert.equal(v2.version, 2);
    const history = store.history("-100");
    assert.equal(history.length, 2);
    assert.equal(history[0].version, 2, "последняя версия первой");
    assert.equal(history[1].source, "preset:listener");
    store.close();
  });
});

describe("LLM structured extraction custom-правил", () => {
  it("валидный JSON → patch", async () => {
    const patch = await extractPolicyPatch("слушай всех, сохраняй фотографии", async () =>
      JSON.stringify({
        archive: { photo: true, text: true },
        processing: { photoOcr: true },
        response: { mode: "mention_or_reply" },
      }),
    );
    assert.ok(patch);
    assert.equal(patch!.archive?.photo, true);
    assert.equal(patch!.response?.mode, "mention_or_reply");
  });

  it("natural language через mocked LLM (положительные фразы)", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["слушай всех", { archive: { text: true }, response: { mode: "never" } }],
      ["не отвечай сам", { response: { mode: "never" } }],
      ["сохраняй фотографии", { archive: { photo: true } }],
      ["распознавай фотографии", { processing: { photoOcr: true } }],
      ["транскрибируй голосовые", { processing: { voiceStt: true } }],
      ["сохраняй документы", { archive: { document: true } }],
      ["отвечай только по упоминанию", { response: { mode: "mention" } }],
    ];
    for (const [text, json] of cases) {
      const patch = await extractPolicyPatch(text, async () => JSON.stringify(json));
      assert.ok(patch, `фраза «${text}» должна давать patch`);
    }
  });

  it("negative: shell/ACL/пароль невыразимы и отвергаются", async () => {
    const negative = [
      { tools: { shell: true } },
      { security: { acl: false } },
      { password: "секрет" },
      { sql: "DELETE FROM users" },
    ];
    for (const bad of negative) {
      const { patch, error } = validatePolicyPatch(bad);
      assert.equal(patch, undefined, `«${JSON.stringify(bad)}» не должен валидироваться`);
      assert.ok(error);
    }
    // Даже если LLM вернёт «удали базу» — extractPolicyPatch вернёт null → regex fallback.
    const res = await extractPolicyPatch("удали базу", async () =>
      JSON.stringify({ action: "delete database" }),
    );
    assert.equal(res, null);
    const res2 = await extractPolicyPatch("запусти shell", async () => "не json вообще");
    assert.equal(res2, null);
  });

  it("policyPatchToRules + превью", () => {
    const rules = policyPatchToRules({
      archive: { photo: true, voice: true, text: true },
      processing: { photoOcr: true, voiceStt: true },
      response: { mode: "mention_or_reply" },
    });
    const keys = new Set(rules.map((r) => r.key));
    assert.ok(keys.has("archive_media"));
    assert.ok(keys.has("archive_ocr_ingest"));
    assert.ok(keys.has("listen_only"), "архив текста = слушатель");
    const preview = previewPolicyPatch({
      archive: { photo: true },
      processing: { photoOcr: true },
      response: { mode: "mention" },
    });
    assert.ok(preview.includes("Фотографии сохранять"));
    assert.ok(preview.includes("распознавать"));
    assert.ok(preview.includes("@упоминание"));
  });

  it("пустой patch → null (ничего не менять)", async () => {
    const res = await extractPolicyPatch("просто привет", async () => JSON.stringify({}));
    assert.equal(res, null);
  });
});
