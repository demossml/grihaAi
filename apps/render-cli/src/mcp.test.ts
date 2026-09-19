import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatchRequest, type JsonRpcRequest } from "./mcp/server.js";

test("initialize → serverInfo name griha-render", async () => {
  const resp = await dispatchRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(resp.id, 1);
  const result = resp.result as { protocolVersion: string; serverInfo: { name: string; version: string } };
  assert.equal(result.serverInfo.name, "griha-render");
  assert.ok(result.protocolVersion.length > 0);
});

test("tools/list → length >= 1 и содержит render_pdf", async () => {
  const resp = await dispatchRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const result = resp.result as { tools: Array<{ name: string }> };
  assert.ok(result.tools.length >= 1);
  assert.ok(result.tools.some((t) => t.name === "render_pdf"));
});

test("tools/call list_templates → content text JSON-массив", async () => {
  const resp = await dispatchRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_templates" },
  });
  const result = resp.result as { content: Array<{ type: string; text: string }> };
  const list = JSON.parse(result.content[0].text);
  assert.deepEqual([...list].sort(), ["expense-report", "meeting-minutes", "sales-report"]);
});

test("tools/call render_pdf invalid → isError true", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-"));
  try {
    const resp = await dispatchRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "render_pdf",
        arguments: {
          outDir: dir,
          request: { template: "expense-report", title: "", blocks: [] },
        },
      },
    });
    const result = resp.result as { content: Array<{ text: string }>; isError: boolean };
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tools/call render_pdf valid → isError false, ok true", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-"));
  try {
    const resp = await dispatchRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "render_pdf",
        arguments: {
          outDir: dir,
          request: {
            template: "expense-report",
            title: "Отчёт",
            locale: "ru",
            blocks: [{ kind: "markdown", text: "запас" }],
            data: { period: "тест", totalAmount: 100, categories: [{ name: "Тест", amount: 100 }], items: [] },
          },
        },
      },
    });
    const result = resp.result as { content: Array<{ text: string }>; isError: boolean };
    assert.equal(result.isError, false);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown tool → error", async () => {
  const resp = await dispatchRequest({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "nope" },
  } as JsonRpcRequest);
  assert.ok(resp.error);
});
