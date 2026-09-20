/**
 * O5 — obs-tools: obs_query / obs_summary читают JSONL (без LLM), ACL canManage.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setSessionContext, clearSessionContext } from "../../.pi/extensions/user-rules/context.js";

interface CapturedTool {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx: { sessionManager: { getSessionId(): string } },
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }>;
}

const tmpDirs: string[] = [];
const savedObsDir = process.env.GRIHA_OBS_DIR;

after(() => {
  clearSessionContext("sess-obs");
  clearSessionContext("sess-other");
  if (savedObsDir === undefined) delete process.env.GRIHA_OBS_DIR;
  else process.env.GRIHA_OBS_DIR = savedObsDir;
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function writeEvents(dir: string): void {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `events-${day}.jsonl`);
  const now = new Date().toISOString();
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ ts: now, level: "info", component: "telegram.gate", event: "gate.block", chatId: "-100" }),
      JSON.stringify({ ts: now, level: "info", component: "report.render", event: "report.render.end", ok: false }),
      "",
    ].join("\n"),
    "utf8",
  );
}

let tools: Record<string, CapturedTool> = {};

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-tools-"));
  tmpDirs.push(dir);
  process.env.GRIHA_OBS_DIR = dir;
  writeEvents(dir);

  const mod = await import("../../.pi/extensions/obs-tools/index.js");
  const pi = {
    registerTool: (t: unknown) => {
      const cand = t as CapturedTool;
      tools[cand.name] = cand;
    },
  } as unknown as ExtensionAPI;
  mod.default(pi);

  // owner → canManage true (без чтения users.json).
  setSessionContext("sess-obs", { chatId: "-100", userId: "owner" });
});

const ctx = { sessionManager: { getSessionId: () => "sess-obs" } };

describe("obs-tools (O5)", () => {
  it("obs_query → count >= 1", async () => {
    const tool = tools["obs_query"];
    assert.ok(tool, "obs_query зарегистрирован");
    const res = await tool.execute("c1", { sinceMinutes: 60, limit: 30 }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!) as { count: number };
    assert.ok(parsed.count >= 1);
  });

  it("obs_summary → total >= 1", async () => {
    const tool = tools["obs_summary"];
    assert.ok(tool, "obs_summary зарегистрирован");
    const res = await tool.execute("c2", { sinceMinutes: 60 }, null, null, ctx);
    const parsed = JSON.parse(res.content[0].text!) as { total: number };
    assert.ok(parsed.total >= 1);
  });

  it("не-operator → deny", async () => {
    clearSessionContext("sess-obs"); // userId → ""
    setSessionContext("sess-other", { chatId: "-100", userId: "999" });
    const otherCtx = { sessionManager: { getSessionId: () => "sess-other" } };
    const res = await tools["obs_summary"].execute("c3", { sinceMinutes: 60 }, null, null, otherCtx);
    assert.ok(res.content[0].text!.includes("оператора"));
  });
});
