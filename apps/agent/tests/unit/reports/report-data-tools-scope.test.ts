/**
 * Scope-матрица tools report_data_* (группа vs личка, ACL, groupQuery).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../../src/services/documents/DocumentsRepository.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setSessionContext } from "../../../.pi/extensions/user-rules/context.js";
import type { GroupAccessDeps } from "../../../src/services/documents/groupHistoryTools.js";

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }>;
}

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

const ctx = { sessionManager: { getSessionId: () => "sess-scope" } };

function acl(allow: boolean): GroupAccessDeps {
  return {
    isConfiguredSync: () => true,
    canManage: async () => false,
    isAllowed: async () => allow,
    listConfiguredChatIds: async () => [],
  };
}

async function captureTools(repo: DocumentsRepository, deps: {
  aclDeps: GroupAccessDeps;
  listSetupRecords: () => Promise<Array<{ chatId: string; chatTitle: string | null }>>;
}): Promise<CapturedTool> {
  const captured = new Map<string, CapturedTool>();
  const pi = {
    registerTool: (t: unknown) => {
      const cand = t as CapturedTool;
      captured.set(cand.name, cand);
    },
  } as unknown as ExtensionAPI;
  const mod = await import("../../../.pi/extensions/documents/index.js");
  mod.default(pi, { documentsRepo: repo, aclDeps: deps.aclDeps, listSetupRecords: deps.listSetupRecords });
  const tool = captured.get("report_data_expenses");
  if (!tool) throw new Error("report_data_expenses не зарегистрирован");
  return tool;
}

describe("report_data scope (группа vs личка)", () => {
  it("group + args другой chatId → CHAT_MISMATCH, service не вызван", async () => {
    setSessionContext("sess-scope", { chatId: "-100", userId: "1" });
    const tool = await captureTools(makeRepo(), { aclDeps: acl(true), listSetupRecords: async () => [] });
    const res = await tool.execute("c1", { chatId: "-200", format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "CHAT_MISMATCH");
  });

  it("private + нет chatId и groupQuery → MISSING_CHAT_ID", async () => {
    setSessionContext("sess-scope", { chatId: "123", userId: "1" });
    const tool = await captureTools(makeRepo(), { aclDeps: acl(true), listSetupRecords: async () => [] });
    const res = await tool.execute("c2", { format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "MISSING_CHAT_ID");
  });

  it("private + chatId + ACL deny → DENY, service не вызван", async () => {
    setSessionContext("sess-scope", { chatId: "123", userId: "1" });
    const tool = await captureTools(makeRepo(), { aclDeps: acl(false), listSetupRecords: async () => [] });
    const res = await tool.execute("c3", { chatId: "-100", format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "DENY");
  });

  it("private + chatId + ACL allow → service с этим chatId", async () => {
    setSessionContext("sess-scope", { chatId: "123", userId: "1" });
    const tool = await captureTools(makeRepo(), { aclDeps: acl(true), listSetupRecords: async () => [] });
    const res = await tool.execute("c4", { chatId: "-100", format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.report.chatId, "-100");
  });

  it("private + groupQuery 'Ремонт' + один setup record → service с его chatId", async () => {
    setSessionContext("sess-scope", { chatId: "123", userId: "1" });
    const tool = await captureTools(makeRepo(), {
      aclDeps: acl(true),
      listSetupRecords: async () => [{ chatId: "-100", chatTitle: "Ремонт" }],
    });
    const res = await tool.execute("c5", { groupQuery: "Ремонт", format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.report.chatId, "-100");
  });

  it("private + groupQuery ambiguous → AMBIGUOUS + candidates, service не вызван", async () => {
    setSessionContext("sess-scope", { chatId: "123", userId: "1" });
    const tool = await captureTools(makeRepo(), {
      aclDeps: acl(true),
      listSetupRecords: async () => [
        { chatId: "-100", chatTitle: "Ремонт квартиры" },
        { chatId: "-200", chatTitle: "Ремонт дачи" },
      ],
    });
    const res = await tool.execute("c6", { groupQuery: "ремонт", format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "AMBIGUOUS");
    assert.equal(parsed.candidates.length, 2);
  });

  it("group → service с ctx chatId; groupQuery не переключает", async () => {
    setSessionContext("sess-scope", { chatId: "-100", userId: "1" });
    const tool = await captureTools(makeRepo(), {
      aclDeps: acl(true),
      listSetupRecords: async () => [{ chatId: "-200", chatTitle: "Другая группа" }],
    });
    const res = await tool.execute("c7", { groupQuery: "Другая группа", format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.report.chatId, "-100");
  });
});
