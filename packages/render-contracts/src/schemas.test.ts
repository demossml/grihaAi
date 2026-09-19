import { test } from "node:test";
import assert from "node:assert/strict";
import { RenderRequestSchema } from "./schemas.js";

test("валидный request: expense-report + один markdown block → success", () => {
  const res = RenderRequestSchema.safeParse({
    format: "pdf",
    template: "expense-report",
    title: "Отчёт о расходах",
    blocks: [{ kind: "markdown", text: "# Итоги" }],
  });
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.template, "expense-report");
    assert.equal(res.data.locale, "ru");
  }
});

test("blocks: [] → fail", () => {
  const res = RenderRequestSchema.safeParse({
    format: "pdf",
    template: "expense-report",
    title: "Отчёт",
    blocks: [],
  });
  assert.equal(res.success, false);
});

test('template: "unknown" → fail', () => {
  const res = RenderRequestSchema.safeParse({
    format: "pdf",
    template: "unknown",
    title: "Отчёт",
    blocks: [{ kind: "markdown", text: "x" }],
  });
  assert.equal(res.success, false);
});

test('title: "" → fail', () => {
  const res = RenderRequestSchema.safeParse({
    format: "pdf",
    template: "expense-report",
    title: "",
    blocks: [{ kind: "markdown", text: "x" }],
  });
  assert.equal(res.success, false);
});

test("locale по умолчанию ru при parse без locale", () => {
  const res = RenderRequestSchema.safeParse({
    format: "pdf",
    template: "expense-report",
    title: "Отчёт",
    blocks: [{ kind: "markdown", text: "x" }],
  });
  assert.equal(res.success, true);
  if (res.success) assert.equal(res.data.locale, "ru");
});
