/**
 * document_fill tool — wiring (scope + ACL) поверх service.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../../src/services/documents/types.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fill-tool-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeDoc(over: Partial<ExpenseDocument>): ExpenseDocument {
  return {
    id: "e1",
    chatId: "-100",
    docDate: "2026-09-10",
    supplier: undefined,
    total: undefined,
    currency: "RUB",
    kind: "receipt",
    confidence: 0.4,
    needsReview: true,
    rawText: "чек",
    source: "telegram",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

const ctx = { sessionManager: { getSessionId: () => "sess-fill" } };

function acl(allow: boolean): GroupAccessDeps {
  return {
    isConfiguredSync: () => true,
    canManage: async () => false,
    isAllowed: async () => allow,
    listConfiguredChatIds: async () => [],
  };
}

async function captureTool(repo: DocumentsRepository, deps: {
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
  const tool = captured.get("document_fill");
  if (!tool) throw new Error("document_fill не зарегистрирован");
  return tool;
}

describe("document_fill tool", () => {
  it("group → fill по ctx группе, needs_review очищен", async () => {
    setSessionContext("sess-fill", { chatId: "-100", userId: "1" });
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "e1" }));
    const tool = await captureTool(repo, { aclDeps: acl(true), listSetupRecords: async () => [] });

    const res = await tool.execute("c1", { expenseId: "e1", total: 100 }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.after.needsReview, false);
    assert.equal(parsed.after.total, 100);
  });

  it("private + chatId + ACL deny → DENY, обновление не выполнено", async () => {
    setSessionContext("sess-fill", { chatId: "123", userId: "1" });
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "e1" }));
    const tool = await captureTool(repo, { aclDeps: acl(false), listSetupRecords: async () => [] });

    const res = await tool.execute("c2", { expenseId: "e1", chatId: "-100", total: 100 }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "DENY");
    assert.equal(repo.getExpenseById("e1")!.total, undefined, "total не изменён");
  });
});
