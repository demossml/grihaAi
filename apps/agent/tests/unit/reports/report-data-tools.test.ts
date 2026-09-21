/**
 * D6: tools report_data_expenses / report_data_problems (JSON, fail closed на
 * отсутствии chatId).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d6-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeDoc(over: Partial<ExpenseDocument>): ExpenseDocument {
  return {
    id: "doc-1",
    chatId: "-100",
    docDate: "2026-09-10",
    supplier: "Магнит",
    total: 507.99,
    currency: "RUB",
    kind: "receipt",
    confidence: 1,
    needsReview: false,
    rawText: "чек",
    source: "telegram",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

const ctx = { sessionManager: { getSessionId: () => "sess-d6" } };

function aclAllow(): GroupAccessDeps {
  return {
    isConfiguredSync: () => true,
    canManage: async () => true,
    isAllowed: async () => true,
    listConfiguredChatIds: async () => [],
  };
}

async function captureTools(repo: DocumentsRepository): Promise<Map<string, CapturedTool>> {
  const captured = new Map<string, CapturedTool>();
  const pi = {
    registerTool: (t: unknown) => {
      const cand = t as CapturedTool;
      captured.set(cand.name, cand);
    },
  } as unknown as ExtensionAPI;
  const mod = await import("../../../.pi/extensions/documents/index.js");
  mod.default(pi, {
    documentsRepo: repo,
    aclDeps: aclAllow(),
    listSetupRecords: async () => [],
  });
  return captured;
}

describe("report_data tools (D6)", () => {
  it("report_data_expenses → JSON ok, report.summary заполнен", async () => {
    setSessionContext("sess-d6", { chatId: "-100", userId: "1" });
    const repo = makeRepo();
    await repo.insert(makeDoc({}));
    await repo.insert(makeDoc({ id: "doc-2", supplier: "Грузчик", total: 1000, needsReview: true }));

    const tools = await captureTools(repo);
    const tool = tools.get("report_data_expenses");
    assert.ok(tool, "report_data_expenses зарегистрирован");

    const res = await tool!.execute("c1", { format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.report.chatId, "-100");
    assert.equal(parsed.report.summary.documentCount, 2);
    assert.equal(parsed.report.summary.problemCount, 1);
  });

  it("report_data_problems → JSON ok, count >= 1", async () => {
    setSessionContext("sess-d6", { chatId: "-100", userId: "1" });
    const repo = makeRepo();
    await repo.insert(makeDoc({ total: undefined, needsReview: true }));

    const tools = await captureTools(repo);
    const tool = tools.get("report_data_problems");
    assert.ok(tool, "report_data_problems зарегистрирован");

    const res = await tool!.execute("c2", {}, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.problems.count >= 1);
  });

  it("private без chatId → MISSING_CHAT_ID (fail closed)", async () => {
    setSessionContext("sess-d6", { chatId: "123", userId: "1" });
    const repo = makeRepo();
    const tools = await captureTools(repo);
    const tool = tools.get("report_data_expenses")!;

    const res = await tool.execute("c3", { format: "compact" }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "MISSING_CHAT_ID");
  });
});
