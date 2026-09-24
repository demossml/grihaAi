import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import {
  normalizePaymentPurpose,
  recordSecretaryExpense,
} from "../../src/services/secretary/secretary-record-expense.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-expense-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

test("normalizePaymentPurpose: валидное → как есть; неизвестное/пустое → other", () => {
  assert.equal(normalizePaymentPurpose("materials"), "materials");
  assert.equal(normalizePaymentPurpose("services"), "services");
  assert.equal(normalizePaymentPurpose("bogus"), "other");
  assert.equal(normalizePaymentPurpose(undefined), "other");
});

test("recordSecretaryExpense: запись + purpose materials, needsReview=false, source=secretary", async () => {
  const repo = makeRepo();
  const doc = await recordSecretaryExpense(
    repo,
    {
      chatId: "-100",
      amount: 1500,
      currency: "RUB",
      supplier: "Ромашка",
      paymentPurpose: "materials",
      note: "болты",
      sourceMessageId: "42",
    },
    "7",
  );
  assert.equal(doc.paymentPurpose, "materials");
  assert.equal(doc.total, 1500);
  assert.equal(doc.supplier, "Ромашка");
  assert.equal(doc.needsReview, false);
  assert.equal(doc.source, "secretary");
  assert.equal(doc.chatId, "-100");
  assert.equal(doc.fromUserId, "7");
  repo.close();
});

test("recordSecretaryExpense: unknown purpose → other", async () => {
  const repo = makeRepo();
  const doc = await recordSecretaryExpense(repo, {
    chatId: "-100",
    amount: 100,
    paymentPurpose: "неизвестно",
  });
  assert.equal(doc.paymentPurpose, "other");
  repo.close();
});
