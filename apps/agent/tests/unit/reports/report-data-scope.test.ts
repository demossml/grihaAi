/**
 * resolveReportDataScope — чистая функция scope (группа vs личка).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReportDataScope } from "../../../src/services/documents/reportDataScope.js";

test("group: args без chatId → ctx chatId, source ctx_group", () => {
  const r = resolveReportDataScope({ ctxChatId: "-100", ctxChatType: "group" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.chatId, "-100");
  assert.equal(r.source, "ctx_group");
});

test("group: args chatId другой → CHAT_MISMATCH", () => {
  const r = resolveReportDataScope({
    ctxChatId: "-100",
    ctxChatType: "group",
    argsChatId: "-200",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "CHAT_MISMATCH");
});

test("group: args chatId совпадает → ok", () => {
  const r = resolveReportDataScope({
    ctxChatId: "-100",
    ctxChatType: "group",
    argsChatId: "-100",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.chatId, "-100");
});

test("private: args без chatId → MISSING_CHAT_ID", () => {
  const r = resolveReportDataScope({ ctxChatType: "private" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "MISSING_CHAT_ID");
});

test("private: args chatId → ok, source args_private", () => {
  const r = resolveReportDataScope({ ctxChatType: "private", argsChatId: "-100" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.chatId, "-100");
  assert.equal(r.source, "args_private");
});

test("threadId: group + ctxThreadId, args без thread → ctx thread", () => {
  const r = resolveReportDataScope({
    ctxChatId: "-100",
    ctxChatType: "group",
    ctxThreadId: "5",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.threadId, "5");
});

test("threadId: args threadId побеждает ctx", () => {
  const r = resolveReportDataScope({
    ctxChatId: "-100",
    ctxChatType: "group",
    ctxThreadId: "5",
    argsThreadId: "9",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.threadId, "9");
});
